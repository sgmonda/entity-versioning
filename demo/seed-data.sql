-- Seed data for demo playground
-- Lookup tables only — entity data is inserted via TypeScript (after ev start)

-- Languages
INSERT INTO language (id, code, name) VALUES
  (1, 'en', 'English'),
  (2, 'es', 'Spanish'),
  (3, 'fr', 'French');

-- Course states
INSERT INTO course_state (id, name) VALUES
  (1, 'draft'),
  (2, 'active'),
  (3, 'completed'),
  (4, 'archived');

-- Users (2 teachers + 3 students)
INSERT INTO "user" (id, name, email) VALUES
  (1, 'Alice Martin', 'alice@example.com'),
  (2, 'Bob Chen', 'bob@example.com'),
  (3, 'Carol López', 'carol@example.com'),
  (4, 'David Kim', 'david@example.com'),
  (5, 'Eva Müller', 'eva@example.com');

-- Countries
INSERT INTO country (id, code, name) VALUES
  (1, 'US', 'United States'),
  (2, 'ES', 'Spain'),
  (3, 'DE', 'Germany');

-- Reset sequences to avoid conflicts
SELECT setval('language_id_seq', 3);
SELECT setval('course_state_id_seq', 4);
SELECT setval('"user_id_seq"', 5);
SELECT setval('country_id_seq', 3);
