ALTER TABLE `subscriptions` ADD `synced` integer DEFAULT 0 NOT NULL;
UPDATE `subscriptions` SET `source` = 'local' WHERE `source` = 'cloud';
