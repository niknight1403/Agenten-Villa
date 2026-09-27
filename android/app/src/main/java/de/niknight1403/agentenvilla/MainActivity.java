package de.niknight1403.agentenvilla;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(VillaStoragePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
