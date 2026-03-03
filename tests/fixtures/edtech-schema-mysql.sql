-- EdTech schema fixture for testing entity versioning (MySQL version)
-- Based on SPEC example: course, billing, class entities with children

-- Lookup tables (no outgoing FKs, only incoming)
CREATE TABLE IF NOT EXISTS `user` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS language (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS country (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS course_state (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL
);

-- Entity root: course
CREATE TABLE IF NOT EXISTS course (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  `languageId` INT,
  `courseStateId` INT,
  `startDate` DATE,
  `endDate` DATE,
  `createdAt` DATETIME(6) DEFAULT NOW(6),
  FOREIGN KEY (`languageId`) REFERENCES language(id),
  FOREIGN KEY (`courseStateId`) REFERENCES course_state(id)
);

-- Course children
CREATE TABLE IF NOT EXISTS course_upsell (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT NOT NULL,
  licenses INT,
  `hourCostTraining` DECIMAL(10,2),
  FOREIGN KEY (`courseId`) REFERENCES course(id)
);

CREATE TABLE IF NOT EXISTS course_service (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT NOT NULL,
  `serviceName` VARCHAR(100),
  active TINYINT(1) DEFAULT 1,
  FOREIGN KEY (`courseId`) REFERENCES course(id)
);

CREATE TABLE IF NOT EXISTS course_users_user (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT NOT NULL,
  `userId` INT NOT NULL,
  role VARCHAR(50) DEFAULT 'student',
  FOREIGN KEY (`courseId`) REFERENCES course(id),
  FOREIGN KEY (`userId`) REFERENCES `user`(id)
);

CREATE TABLE IF NOT EXISTS course_teacher_blacklist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT NOT NULL,
  `teacherId` INT NOT NULL,
  reason VARCHAR(200),
  FOREIGN KEY (`courseId`) REFERENCES course(id),
  FOREIGN KEY (`teacherId`) REFERENCES `user`(id)
);

CREATE TABLE IF NOT EXISTS course_forum_topic (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT NOT NULL,
  title VARCHAR(200),
  `createdAt` DATETIME(6) DEFAULT NOW(6),
  FOREIGN KEY (`courseId`) REFERENCES course(id)
);

-- Entity root: billing
CREATE TABLE IF NOT EXISTS billing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT,
  amount DECIMAL(12,2),
  status VARCHAR(20) DEFAULT 'pending',
  `createdAt` DATETIME(6) DEFAULT NOW(6),
  FOREIGN KEY (`userId`) REFERENCES `user`(id)
);

-- Billing children
CREATE TABLE IF NOT EXISTS billing_line (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `billingId` INT NOT NULL,
  description VARCHAR(200),
  amount DECIMAL(12,2),
  FOREIGN KEY (`billingId`) REFERENCES billing(id)
);

CREATE TABLE IF NOT EXISTS billing_rate_incentive (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `billingId` INT NOT NULL,
  rate DECIMAL(5,2),
  `incentiveType` VARCHAR(50),
  FOREIGN KEY (`billingId`) REFERENCES billing(id)
);

CREATE TABLE IF NOT EXISTS billing_bonus_course_tutor (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `invoiceId` INT NOT NULL,
  bonus DECIMAL(10,2),
  `courseId` INT,
  FOREIGN KEY (`invoiceId`) REFERENCES billing(id),
  FOREIGN KEY (`courseId`) REFERENCES course(id)
);

-- Entity root: class
CREATE TABLE IF NOT EXISTS class (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT,
  `teacherId` INT,
  `scheduledAt` DATETIME(6),
  duration INT DEFAULT 60,
  status VARCHAR(20) DEFAULT 'scheduled',
  FOREIGN KEY (`courseId`) REFERENCES course(id),
  FOREIGN KEY (`teacherId`) REFERENCES `user`(id)
);

-- Class children
CREATE TABLE IF NOT EXISTS class_evaluations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `classId` INT NOT NULL,
  `studentId` INT,
  score INT,
  feedback TEXT,
  FOREIGN KEY (`classId`) REFERENCES class(id),
  FOREIGN KEY (`studentId`) REFERENCES `user`(id)
);

CREATE TABLE IF NOT EXISTS class_feedback_teacher (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `classId` INT NOT NULL,
  rating INT,
  comment TEXT,
  FOREIGN KEY (`classId`) REFERENCES class(id)
);

CREATE TABLE IF NOT EXISTS class_issue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `classId` INT NOT NULL,
  `issueType` VARCHAR(50),
  description TEXT,
  resolved TINYINT(1) DEFAULT 0,
  FOREIGN KEY (`classId`) REFERENCES class(id)
);

CREATE TABLE IF NOT EXISTS class_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `classId` INT NOT NULL,
  status VARCHAR(20),
  `changedAt` DATETIME(6) DEFAULT NOW(6),
  FOREIGN KEY (`classId`) REFERENCES class(id)
);

CREATE TABLE IF NOT EXISTS chat (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `classId` INT NOT NULL,
  `userId` INT,
  message TEXT,
  `sentAt` DATETIME(6) DEFAULT NOW(6),
  FOREIGN KEY (`classId`) REFERENCES class(id),
  FOREIGN KEY (`userId`) REFERENCES `user`(id)
);

-- Isolated tables (no FKs at all)
CREATE TABLE IF NOT EXISTS migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  `executedAt` DATETIME(6) DEFAULT NOW(6)
);

CREATE TABLE IF NOT EXISTS bi_calendar (
  `date` DATE PRIMARY KEY,
  year INT,
  quarter INT,
  month INT,
  `dayOfWeek` INT
);

-- Table with self-referential FK
CREATE TABLE IF NOT EXISTS category (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  `parentId` INT,
  FOREIGN KEY (`parentId`) REFERENCES category(id)
);

-- Table without PK (edge case)
CREATE TABLE IF NOT EXISTS tracking_event (
  event_type VARCHAR(50),
  payload JSON,
  `createdAt` DATETIME(6) DEFAULT NOW(6)
);

-- Table with FK to multiple roots (conflict case)
CREATE TABLE IF NOT EXISTS activity_answer (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `courseId` INT NOT NULL,
  `classId` INT NOT NULL,
  `studentId` INT,
  answer TEXT,
  FOREIGN KEY (`courseId`) REFERENCES course(id),
  FOREIGN KEY (`classId`) REFERENCES class(id),
  FOREIGN KEY (`studentId`) REFERENCES `user`(id)
);
