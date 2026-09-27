package de.niknight1403.agentenvilla;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Access is limited to a directory explicitly chosen with Android's Storage Access Framework. */
@CapacitorPlugin(name = "VillaStorage")
public class VillaStoragePlugin extends Plugin {
    private static final String PREFS = "villa-storage";
    private static final String TREE = "selected-tree";
    private static final int MAX_ENTRIES = 3000;
    private static final Set<String> CATEGORIES = new HashSet<>(Arrays.asList("Bilder", "Videos", "Audio", "Dokumente", "Archive", "Andere"));

    @PluginMethod
    public void pickTree(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickedTree");
    }

    @ActivityCallback
    private void pickedTree(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Keine Ordnerfreigabe erteilt.");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            DocumentFile folder = DocumentFile.fromTreeUri(getContext(), uri);
            if (folder == null || !folder.isDirectory() || !folder.canWrite()) throw new IllegalStateException("Der Ordner ist nicht schreibbar.");
            getContext().getSharedPreferences(PREFS, 0).edit().putString(TREE, uri.toString()).apply();
            JSObject output = new JSObject();
            output.put("name", folder.getName());
            call.resolve(output);
        } catch (Exception error) {
            call.reject("Ordnerfreigabe fehlgeschlagen: " + error.getMessage());
        }
    }

    private DocumentFile selectedRoot() {
        String stored = getContext().getSharedPreferences(PREFS, 0).getString(TREE, null);
        if (stored == null) throw new IllegalStateException("Bitte zuerst einen Ordner wählen.");
        Uri uri = Uri.parse(stored);
        boolean granted = false;
        for (android.content.UriPermission permission : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(uri) && permission.isReadPermission() && permission.isWritePermission()) granted = true;
        }
        if (!granted) throw new IllegalStateException("Ordnerfreigabe abgelaufen. Bitte erneut wählen.");
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), uri);
        if (root == null || !root.isDirectory()) throw new IllegalStateException("Ordner nicht mehr verfügbar.");
        return root;
    }

    @PluginMethod
    public void scan(PluginCall call) {
        try {
            DocumentFile root = selectedRoot();
            DocumentFile[] children = root.listFiles();
            JSArray entries = new JSArray();
            for (int index = 0; index < Math.min(children.length, MAX_ENTRIES); index++) {
                DocumentFile file = children[index];
                JSObject entry = new JSObject();
                entry.put("id", file.getUri().toString());
                entry.put("name", file.getName() == null ? "Unbenannt" : file.getName());
                entry.put("size", Math.max(0, file.length()));
                entry.put("modified", Math.max(0, file.lastModified()));
                entry.put("mime", file.getType() == null ? "" : file.getType());
                entry.put("directory", file.isDirectory());
                entries.put(entry);
            }
            JSObject output = new JSObject();
            output.put("name", root.getName());
            output.put("entries", entries);
            output.put("truncated", children.length > MAX_ENTRIES);
            call.resolve(output);
        } catch (Exception error) {
            call.reject("Ordner kann nicht gelesen werden: " + error.getMessage());
        }
    }

    @PluginMethod
    public void execute(PluginCall call) {
        String id = call.getString("id");
        String operation = call.getString("operation");
        String expectedName = call.getString("expectedName");
        long expectedSize = call.getData().optLong("expectedSize", -1);
        if (id == null || expectedName == null || expectedSize < 0 || !("delete".equals(operation) || "move".equals(operation))) {
            call.reject("Ungültige Dateiaktion.");
            return;
        }
        try {
            DocumentFile root = selectedRoot();
            DocumentFile[] children = root.listFiles();
            if (children.length > MAX_ENTRIES) throw new IllegalStateException("Zu viele Einträge; bitte einen kleineren Ordner wählen.");
            DocumentFile file = null;
            for (DocumentFile child : children) {
                if (child.getUri().toString().equals(id)) { file = child; break; }
            }
            if (file == null || !file.isFile() || !file.canWrite()) throw new IllegalStateException("Datei nicht mehr verfügbar oder nicht schreibbar.");
            if (!expectedName.equals(file.getName()) || expectedSize != file.length()) throw new IllegalStateException("Datei wurde seit der Vorschau verändert. Bitte neu scannen.");
            if ("delete".equals(operation)) {
                if (!file.delete()) throw new IllegalStateException("Provider hat die Löschung abgelehnt.");
            } else {
                String category = call.getString("category");
                if (!CATEGORIES.contains(category)) throw new IllegalStateException("Ungültiger Zielordner.");
                DocumentFile target = root.findFile(category);
                if (target == null) target = root.createDirectory(category);
                if (target == null || !target.isDirectory()) throw new IllegalStateException("Zielordner konnte nicht erstellt werden.");
                Uri moved = DocumentsContract.moveDocument(getContext().getContentResolver(), file.getUri(), root.getUri(), target.getUri());
                if (moved == null) throw new IllegalStateException("Provider unterstützt Verschieben nicht.");
            }
            JSObject output = new JSObject();
            output.put("success", true);
            call.resolve(output);
        } catch (Exception error) {
            call.reject("Dateiaktion fehlgeschlagen: " + error.getMessage());
        }
    }
}
