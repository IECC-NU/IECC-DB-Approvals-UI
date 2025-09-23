-- CREATE DATABASE WTR2;



CREATE TABLE IF NOT EXISTS department (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS activity (
    activity_id SERIAL PRIMARY KEY,
    activity_name VARCHAR(255) NOT NULL,
    service_line VARCHAR(255) NOT NULL,
    UNIQUE (activity_name, service_line)
);

CREATE TABLE IF NOT EXISTS projects (
    project_id SERIAL PRIMARY KEY,
    coda_row_id VARCHAR(128) NOT NULL UNIQUE,
    deal_name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    initialization_date DATE,
    service_funnel_legacy VARCHAR(255),
    deal_status VARCHAR(100),
    personnel_deal_size DECIMAL(15,2),
    opex_deal_size DECIMAL(15,2),
    total_budget DECIMAL(15,2),
    service TEXT,
    fund_source VARCHAR(255),
    crm_id VARCHAR(255) UNIQUE,
    deal_closed_date DATE,
    lead_affiliation VARCHAR(255),
    deal_description TEXT,
    technical_area VARCHAR(255),
    closed_won_date DATE
);

CREATE TABLE IF NOT EXISTS employee (
    employee_nuid INT NOT NULL PRIMARY KEY,
    employee_id SERIAL UNIQUE,
    employee_name VARCHAR(255) NOT NULL,
    employee_email VARCHAR(255) NOT NULL UNIQUE,
    employee_title VARCHAR(255),
    department_id INT, -- Foreign key to the department table
    CONSTRAINT fk_employee_department
        FOREIGN KEY (department_id) REFERENCES department(department_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS authentication (
    auth_id SERIAL PRIMARY KEY,
    employee_nuid INT NOT NULL UNIQUE,
    employee_name VARCHAR(255) NOT NULL,
    employee_email VARCHAR(255) NOT NULL UNIQUE,
    password_hash BYTEA NOT NULL, -- To store hashed passwords
    CONSTRAINT fk_auth_employee
        FOREIGN KEY (employee_nuid) REFERENCES employee(employee_nuid)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_status (
    sync_id SERIAL PRIMARY KEY,
    record_type VARCHAR(255) NOT NULL, -- e.g. 'WTR' or 'LOG'
    sync_status VARCHAR(10) NOT NULL,   -- e.g. 'PENDING', 'SUCCESS', 'FAILED'
    sync_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_time_records (
    wtr_id SERIAL PRIMARY KEY,
    employee_nuid INT NOT NULL,
    wtr_month SMALLINT NOT NULL,
    wtr_year SMALLINT NOT NULL,
    coda_wtr_id VARCHAR(255) NOT NULL UNIQUE, -- Changed to NOT NULL and kept UNIQUE for FK reference
    total_submitted_hours DECIMAL(5,2) DEFAULT 0.00,
    expected_hours DECIMAL(5,2) DEFAULT 0.00,
    approval_status VARCHAR(255) DEFAULT 'Pending',
    sync_id INT NULL,
    UNIQUE (employee_nuid, wtr_month, wtr_year),
    CONSTRAINT fk_wtr_employee
        FOREIGN KEY (employee_nuid) REFERENCES employee(employee_nuid)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wtr_sync_status
        FOREIGN KEY (sync_id) REFERENCES sync_status(sync_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_wtr_month_valid CHECK (wtr_month BETWEEN 1 AND 12),
    CONSTRAINT chk_wtr_year_valid CHECK (wtr_year BETWEEN 1900 AND 2100)
);

CREATE TABLE IF NOT EXISTS details_submission_logs (
    log_id SERIAL PRIMARY KEY,
    coda_wtr_id VARCHAR(255) NOT NULL, -- Changed from wtr_id to reference the Coda ID
    coda_log_id VARCHAR(255) UNIQUE,
    activity_id INT,
    project_id INT,
    hours_submitted DECIMAL(5,2) NOT NULL,
    tech_report_description VARCHAR(255),
    sync_id INT NULL,
    CONSTRAINT fk_dsl_wtr
        FOREIGN KEY (coda_wtr_id) REFERENCES work_time_records(coda_wtr_id) -- Updated FK constraint
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_dsl_sync_status
        FOREIGN KEY (sync_id) REFERENCES sync_status(sync_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_dsl_activity
        FOREIGN KEY (activity_id) REFERENCES activity(activity_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_dsl_project
        FOREIGN KEY (project_id) REFERENCES projects(project_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_dsl_hours_nonneg CHECK (hours_submitted >= 0)
);

-- DATA INSERTION --

-------------------------------------------------------------------------------------------------------------------------------------------
INSERT INTO department (department_name) VALUES
('Innovation'),
('Innovation & Entrepreneurship Center'),
('Quality & Impact, University-Industry Collaboration Office'),
('Startup Acceleration'),
('Venture Product Acceleration'),
('Venture Design'),
('University-Industry Collaboration Office'),
('Community Development'),
('Marketing and Outreach'),
('SME Acceleration'),
('Employee Succes'),
('Media'),
('People and Culture');

-------------------------------------------------------------------------------------------------------------------------------------------

-- Step 2: Populate the employee table, using subqueries to get the correct department_id.
INSERT INTO employee (employee_nuid, employee_name, employee_title, department_id, employee_email) VALUES
(255, 'Heba Labib', 'Assistant VP for Innovation', (SELECT department_id FROM department WHERE department_name = 'Innovation'), 'hlabib@nu.edu.eg'),
(273, 'Ahmed Abdel Moneim Saleh', 'Director of Innovation & Entrepreneurship Center', (SELECT department_id FROM department WHERE department_name = 'Innovation & Entrepreneurship Center'), 'asaleh@nu.edu.eg'),
(398, 'Asmaa Ahmed Youssef', 'Deputy Director of IECC, Associate Director of UIC and Impact', (SELECT department_id FROM department WHERE department_name = 'Quality & Impact, University-Industry Collaboration Office'), 'aahmed@nu.edu.eg'),
(455, 'Yomna Elnahas', 'Head of Startup Acceleration', (SELECT department_id FROM department WHERE department_name = 'Startup Acceleration'), 'yelnahas@nu.edu.eg'),
(640, 'Mahmoud Abdallah Hamed', 'Production Manager', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'mahhamed@nu.edu.eg'),
(487, 'Kamal Sayed Kamal ElSayed', 'Senior Mechanical Design Engineer', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'kelsayed@nu.edu.eg'),
(374, 'Amira Ayman Yassin', 'Product Design Team Leader', (SELECT department_id FROM department WHERE department_name = 'Venture Design'), 'ayassin@nu.edu.eg'),
(1280, 'Aya Gamal Mohamed', 'Senior Associate, Startup Acceleration', (SELECT department_id FROM department WHERE department_name = 'Startup Acceleration'), 'aymohamed@nu.edu.eg'),
(1681, 'ziad mostafa elelimy', 'Embedded Systems Engineer', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'z.elelimy@nu.edu.eg'),
(687, 'Gehad Ashraf Mohamed', 'Senior Product Designer', (SELECT department_id FROM department WHERE department_name = 'Venture Design'), 'gashraf@nu.edu.eg'),
(708, 'Malak Khaled Hanafy', 'Senior Product Designer', (SELECT department_id FROM department WHERE department_name = 'Venture Design'), 'makhaled@nu.edu.eg'),
(552, 'Hisham Gamal', 'Project Manager', (SELECT department_id FROM department WHERE department_name = 'University-Industry Collaboration Office'), 'higamal@nu.edu.eg'),
(1178, 'Merna Mahmoud Sayed', 'Senior Associate Project Manager', (SELECT department_id FROM department WHERE department_name = 'University-Industry Collaboration Office'), 'mhammad@nu.edu.eg'),
(486, 'Ayman Soliman', 'Incubator accounting manager', (SELECT department_id FROM department WHERE department_name = 'Startup Acceleration'), 'aysoliman@nu.edu.eg'),
(1145, 'Amir Eissa Azmy', 'Senior Systems Engineer', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'aeissa@nu.edu.eg'),
(1891, 'Mahmoud Adel Ahmed', 'Data Analyst', (SELECT department_id FROM department WHERE department_name = 'University-Industry Collaboration Office'), 'mahadel@nu.edu.eg'),
(868, 'Mohamed Adel Ahmed Mohamed Hassan', 'Senior Full Stack Develoer', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'mo.adel@nu.edu.eg'),
(1433, 'Leena Hisham', 'Associate, Community Partnerships', (SELECT department_id FROM department WHERE department_name = 'Community Development'), 'l.hisham@nu.edu.eg'),
(1064, 'mostafa elgammal', 'Mentors Relations Specialist', (SELECT department_id FROM department WHERE department_name = 'Community Development'), 'melgammal@nu.edu.eg'),
(682, 'Duaa Nassef', 'Head of Marketing & Outreach', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'dnassef@nu.edu.eg'),
(1344, 'Ahmed Abdelaziz Tolba', 'SME Acceleration Executive', (SELECT department_id FROM department WHERE department_name = 'SME Acceleration'), 'atolba@nu.edu.eg'),
(1221, 'Nourhan Amen Abdelmohsen', 'SME Acceleration Executive', (SELECT department_id FROM department WHERE department_name = 'SME Acceleration'), 'namen@nu.edu.eg'),
(1196, 'Mai Abdelmonem Mahfouz', 'Senior Copywriter', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'maimahfouz@nu.edu.eg'),
(872, 'Mai Alaa Omar', 'Operations Specialist', (SELECT department_id FROM department WHERE department_name = 'Employee Succes'), 'malaa@nu.edu.eg'),
(634, 'Peter Gamal', 'Senior operations supervisor', (SELECT department_id FROM department WHERE department_name = 'Employee Succes'), 'pgamal@nu.edu.eg'),
(412, 'Marcos Efat Latteif', 'Operations Manager', (SELECT department_id FROM department WHERE department_name = 'Employee Succes'), 'mefat@nu.edu.eg'),
(856, 'Karim Mohamed Gordon Lambley', 'media production manager', (SELECT department_id FROM department WHERE department_name = 'Media'), 'kgordon@nu.edu.eg'),
(998, 'Osama Magdy Fawzy', 'Public Relations Manager', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'ofawzy@nu.edu.eg'),
(594, 'Sara Hossam Mohamed', 'Marketing Outreach Lead', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'shossam@nu.edu.eg'),
(1279, 'Nariman AlSaeed El Masry', 'Senior Associate, Startup Acceleration', (SELECT department_id FROM department WHERE department_name = 'Startup Acceleration'), 'nelmasry@nu.edu.eg'),
(713, 'Mohamed Hagras', 'Senior Accountant', (SELECT department_id FROM department WHERE department_name = 'Employee Succes'), 'mhagras@nu.edu.eg'),
(1353, 'Nurian Ahmed Khalifa', 'Senior Associate, SME Acceleration', (SELECT department_id FROM department WHERE department_name = 'SME Acceleration'), 'nuriank@nu.edu.eg'),
(858, 'ibrahim soliman', 'Senior Metal Manufacturing Technician', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'isoliman@nu.edu.eg'),
(1511, 'Nariman Shaaban Sayed-Ahmed', 'Senior People & Culture', (SELECT department_id FROM department WHERE department_name = 'People and Culture'), 'nshaaban@nu.edu.eg'),
(1331, 'Ahmed Alaa Elgharib', 'Embedded Systems Engineer', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'a.elgharib@nu.edu.eg'),
(1402, 'Habiba Zakaria MohyElDin', 'Associate Account Manager', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'hamohy@nu.edu.eg'),
(986, 'Salma Salah aly', 'Senior Graphics & Freehand Illustrator', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'sasalah@nu.edu.eg'),
(729, 'Norhane Ashraf Fouad Ata', 'Senior Graphics Designer', (SELECT department_id FROM department WHERE department_name = 'Marketing and Outreach'), 'nashraf@nu.edu.eg'),
(1234, 'Peter Atef Faheem', 'Media Technician', (SELECT department_id FROM department WHERE department_name = 'Media'), 'pfaheem@nu.edu.eg'),
(1693, 'Mohamed Elkenany', 'Senior Mechanical Design Engineer', (SELECT department_id FROM department WHERE department_name = 'Venture Product Acceleration'), 'melkenany@nu.edu.eg'),
(1836, 'Amr Hossam Dawood', 'One Man Crew', (SELECT department_id FROM department WHERE department_name = 'Media'), 'ahdawood@nu.edu.eg'),
(1853, 'sara gamal', 'Project Coordinator', (SELECT department_id FROM department WHERE department_name = 'Startup Acceleration'), 'selsharkawy@nu.edu.eg'),
(1892, 'Amna Essam Attia', 'Operations Coordinator', (SELECT department_id FROM department WHERE department_name = 'Employee Succes'), 'amenaessam@nu.edu.eg'),
(1780, 'Operations NP', 'Data Analyst', (SELECT department_id FROM department WHERE department_name = 'University-Industry Collaboration Office'), 'operations@np.eg'),
(1781, 'ahmed amin megahed', 'Data Analyst', (SELECT department_id FROM department WHERE department_name = 'University-Industry Collaboration Office'), 'a.amin2151@nu.edu.eg');

-------------------------------------------------------------------------------------------------------------------------------------------

INSERT INTO authentication (employee_nuid, employee_name, employee_email, password_hash)
SELECT
    employee_nuid,
    employee_name,
    employee_email,
    '123456'::bytea -- IMPORTANT: Replace this with a real, secure password hash.
FROM
    employee
WHERE
    employee_nuid IN (273, 398,1781);
	
-------------------------------------------------------------------------------------------------------------------------------------------

INSERT INTO activity (service_line, activity_name) VALUES
-- From Venture Product Acceleration
('Venture Product Acceleration', 'Project Planning'),
('Venture Product Acceleration', 'Requirements Eng.'),
('Venture Product Acceleration', 'Mechanical Design'),
('Venture Product Acceleration', 'Embedded HW Design'),
('Venture Product Acceleration', 'Embedded SW Design'),
('Venture Product Acceleration', 'MicroFactory'),
('Venture Product Acceleration', 'Mobile App Dev'),
('Venture Product Acceleration', 'Web Development'),
('Venture Product Acceleration', 'Product MGMT'),

-- From Employee Success
('Employee Success', 'HR'),
('Employee Success', 'Procurement'),
('Employee Success', 'Contract and Claims Management'),
('Employee Success', 'Events'),
('Employee Success', 'Other Operations'),

-- From UIC
('UIC', 'Business Development'),
('UIC', 'Project Delivery'),

-- From Impact & Automation
('Impact & Automation', 'Impact and Reporting'),
('Impact & Automation', 'Procedures and Systems'),

-- From Leaves & People
('Annual Leave', 'Annual Leave'),
('Sick Leave', 'Sick Leave'),
('People & Culture', 'Talent Development'),

-- From SME Acceleration
('SME Acceleration', 'Program Design'),
('SME Acceleration', 'Deal Flow'),
('SME Acceleration', 'Program Management'),
('SME Acceleration', 'Success Management'),
('SME Acceleration', 'Matchmaking & Demo Day'),
('SME Acceleration', 'Direct Inkind services'),

-- From Business Development
('Business Development', 'Business Development'),

-- From Marketing & Outreach
('Marketing & Outreach', 'Strategy & Planning'),
('Marketing & Outreach', 'Content Creation'),
('Marketing & Outreach', 'Graphics Design'),
('Marketing & Outreach', 'Marketing Management'),
('Marketing & Outreach', 'Media Production'),
('Marketing & Outreach', 'Customer Relationship Management'),
('Marketing & Outreach', 'Marketing Channels development'),

-- From Venture Design
('Venture Design', 'Business Opportunity Assessment'),
('Venture Design', 'User research, design, prototyping and validation'),
('Venture Design', 'Investment Case'),
('Venture Design', 'Co-founder matchmaking'),
('Venture Design', 'Legal Agreement'),
('Venture Design', 'Fund Raising'),
('Venture Design', 'Portfolio Management'),

-- From Community Development
('Community Development', 'Talent Development'),
('Community Development', 'Program Scouting'),
('Community Development', 'Mentorship'),
('Community Development', 'Community Building Events'),
('Community Development', 'Co-Founder Scouting'),

-- From Startup Acceleration
('Startup Acceleration', 'Program Design'),
('Startup Acceleration', 'Deal Flow'),
('Startup Acceleration', 'Program Management'),
('Startup Acceleration', 'Success Management'),
('Startup Acceleration', 'Matchmaking & Demo Day'),
('Startup Acceleration', 'Direct Inkind services');

-------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_wtr_with_details AS
SELECT
  -- WTR (header) fields
  
  wtr.coda_wtr_id,
  e.employee_nuid,
  e.employee_name,
  wtr.wtr_month,
  wtr.wtr_year,
  wtr.total_submitted_hours,
  wtr.expected_hours,
  wtr.approval_status,

  -- Detail (logs) fields
  
  dsl.coda_log_id,
  p.deal_name AS project_name,
  a.service_line,
  a.activity_name AS activity,
  dsl.hours_submitted,
  dsl.tech_report_description

FROM work_time_records AS wtr
JOIN employee AS e ON e.employee_nuid = wtr.employee_nuid
LEFT JOIN details_submission_logs dsl ON dsl.coda_wtr_id = wtr.coda_wtr_id
LEFT JOIN projects AS p ON p.project_id = dsl.project_id
LEFT JOIN activity AS a ON a.activity_id = dsl.activity_id

ORDER BY
  e.employee_name,
  wtr.wtr_month DESC;
  
-------------------------------------------------------------------------------------------------------------------------------------------
SELECT * FROM v_wtr_with_details;
-------------------------------------------------------------------------------------------------------------------------------------------   

SELECT * FROM employee;
SELECT * FROM department;
SELECT * FROM projects;
SELECT * FROM details_submission_logs;
SELECT * FROM work_time_records;
SELECT * FROM activity ORDER BY service_line, activity_name;
SELECT * FROM authentication;
SELECT * FROM sync_status;




DROP VIEW IF EXISTS v_wtr_with_details;
DROP TABLE IF EXISTS details_submission_logs;
DROP TABLE IF EXISTS work_time_records;
DROP TABLE IF EXISTS sync_status;
DELETE FROM authentication;