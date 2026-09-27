CREATE TABLE `project_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`villaId` int NOT NULL,
	`createdBy` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`prompt` text NOT NULL,
	`plan` text,
	`finalAnswer` text,
	`errorMessage` text,
	`status` enum('PLANNING','QUEUED','RUNNING','REVIEWING','COMPLETED','BLOCKED','FAILED','CANCELLED') NOT NULL DEFAULT 'PLANNING',
	`allowGitHub` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `project_tasks_villaId_idx` ON `project_tasks` (`villaId`);--> statement-breakpoint
CREATE INDEX `project_tasks_createdBy_idx` ON `project_tasks` (`createdBy`);--> statement-breakpoint
CREATE INDEX `project_tasks_status_idx` ON `project_tasks` (`status`);--> statement-breakpoint
