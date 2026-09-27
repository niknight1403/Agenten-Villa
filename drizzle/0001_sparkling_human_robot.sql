CREATE TABLE `villas` (
  `id` int AUTO_INCREMENT NOT NULL,
  `createdBy` int NOT NULL,
  `name` varchar(80) NOT NULL,
  `specialty` varchar(80) NOT NULL DEFAULT 'Neuer Agent',
  `icon` enum('villa','bot') NOT NULL DEFAULT 'bot',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `villas_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

CREATE TABLE `villa_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `villaId` int NOT NULL,
  `role` enum('user','assistant') NOT NULL,
  `content` text NOT NULL,
  `provider` varchar(40),
  `model` varchar(128),
  `rating` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `villa_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint

CREATE INDEX `villa_messages_villaId_idx`
  ON `villa_messages` (`villaId`);
--> statement-breakpoint

CREATE INDEX `villas_createdBy_idx`
  ON `villas` (`createdBy`);
  

CREATE INDEX `villa_messages_villaId_idx` ON `villa_messages` (`villaId`);--> statement-breakpoint
CRElATE INDEX `villas_createdBy_idx` ON `villas` (`createdBy`);
