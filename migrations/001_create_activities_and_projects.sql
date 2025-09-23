-- Migration: create activity, projects, and details_submission_logs tables

BEGIN;

CREATE TABLE IF NOT EXISTS activity (
  activity_id SERIAL PRIMARY KEY,
  activity_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  project_id SERIAL PRIMARY KEY,
  deal_name TEXT,
  service_line TEXT
);

CREATE TABLE IF NOT EXISTS details_submission_logs (
  coda_log_id SERIAL PRIMARY KEY,
  coda_wtr_id VARCHAR(255) NOT NULL,
  activity_id INT NULL,
  project_id INT NULL,
  hours_submitted DECIMAL(6,2) DEFAULT 0.00,
  tech_report_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  FOREIGN KEY (activity_id) REFERENCES activity(activity_id) ON UPDATE CASCADE ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_dsl_coda_wtr_id ON details_submission_logs(coda_wtr_id);
CREATE INDEX IF NOT EXISTS idx_dsl_activity_id ON details_submission_logs(activity_id);

COMMIT;
