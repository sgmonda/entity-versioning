-- EdTech schema fixture for testing entity versioning
-- Based on SPEC example: course, billing, class entities with children

-- Lookup tables (no outgoing FKs, only incoming)
CREATE TABLE IF NOT EXISTS "user" (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS language (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS country (
  id SERIAL PRIMARY KEY,
  code VARCHAR(10) NOT NULL,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS course_state (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL
);

-- Entity root: course
CREATE TABLE IF NOT EXISTS course (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  "languageId" INTEGER REFERENCES language(id),
  "courseStateId" INTEGER REFERENCES course_state(id),
  "startDate" DATE,
  "endDate" DATE,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- Course children
CREATE TABLE IF NOT EXISTS course_upsell (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER NOT NULL REFERENCES course(id),
  licenses INTEGER,
  "hourCostTraining" NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS course_service (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER NOT NULL REFERENCES course(id),
  "serviceName" VARCHAR(100),
  active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS course_users_user (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER NOT NULL REFERENCES course(id),
  "userId" INTEGER NOT NULL REFERENCES "user"(id),
  role VARCHAR(50) DEFAULT 'student'
);

CREATE TABLE IF NOT EXISTS course_teacher_blacklist (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER NOT NULL REFERENCES course(id),
  "teacherId" INTEGER NOT NULL REFERENCES "user"(id),
  reason VARCHAR(200)
);

CREATE TABLE IF NOT EXISTS course_forum_topic (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER NOT NULL REFERENCES course(id),
  title VARCHAR(200),
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- Entity root: billing
CREATE TABLE IF NOT EXISTS billing (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER REFERENCES "user"(id),
  amount NUMERIC(12,2),
  status VARCHAR(20) DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- Billing children
CREATE TABLE IF NOT EXISTS billing_line (
  id SERIAL PRIMARY KEY,
  "billingId" INTEGER NOT NULL REFERENCES billing(id),
  description VARCHAR(200),
  amount NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS billing_rate_incentive (
  id SERIAL PRIMARY KEY,
  "billingId" INTEGER NOT NULL REFERENCES billing(id),
  rate NUMERIC(5,2),
  "incentiveType" VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS billing_bonus_course_tutor (
  id SERIAL PRIMARY KEY,
  "invoiceId" INTEGER NOT NULL REFERENCES billing(id),
  bonus NUMERIC(10,2),
  "courseId" INTEGER REFERENCES course(id)
);

-- Entity root: class
CREATE TABLE IF NOT EXISTS class (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER REFERENCES course(id),
  "teacherId" INTEGER REFERENCES "user"(id),
  "scheduledAt" TIMESTAMPTZ,
  duration INTEGER DEFAULT 60,
  status VARCHAR(20) DEFAULT 'scheduled'
);

-- Class children
CREATE TABLE IF NOT EXISTS class_evaluations (
  id SERIAL PRIMARY KEY,
  "classId" INTEGER NOT NULL REFERENCES class(id),
  "studentId" INTEGER REFERENCES "user"(id),
  score INTEGER,
  feedback TEXT
);

CREATE TABLE IF NOT EXISTS class_feedback_teacher (
  id SERIAL PRIMARY KEY,
  "classId" INTEGER NOT NULL REFERENCES class(id),
  rating INTEGER,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS class_issue (
  id SERIAL PRIMARY KEY,
  "classId" INTEGER NOT NULL REFERENCES class(id),
  "issueType" VARCHAR(50),
  description TEXT,
  resolved BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS class_history (
  id SERIAL PRIMARY KEY,
  "classId" INTEGER NOT NULL REFERENCES class(id),
  status VARCHAR(20),
  "changedAt" TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat (
  id SERIAL PRIMARY KEY,
  "classId" INTEGER NOT NULL REFERENCES class(id),
  "userId" INTEGER REFERENCES "user"(id),
  message TEXT,
  "sentAt" TIMESTAMPTZ DEFAULT now()
);

-- Isolated tables (no FKs at all)
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  "executedAt" TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bi_calendar (
  date DATE PRIMARY KEY,
  year INTEGER,
  quarter INTEGER,
  month INTEGER,
  "dayOfWeek" INTEGER
);

-- Table with self-referential FK
CREATE TABLE IF NOT EXISTS category (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  "parentId" INTEGER REFERENCES category(id)
);

-- Table without PK (edge case)
CREATE TABLE IF NOT EXISTS tracking_event (
  event_type VARCHAR(50),
  payload JSONB,
  "createdAt" TIMESTAMPTZ DEFAULT now()
);

-- Table with FK to multiple roots (conflict case)
CREATE TABLE IF NOT EXISTS activity_answer (
  id SERIAL PRIMARY KEY,
  "courseId" INTEGER NOT NULL REFERENCES course(id),
  "classId" INTEGER NOT NULL REFERENCES class(id),
  "studentId" INTEGER REFERENCES "user"(id),
  answer TEXT
);
