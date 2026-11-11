# Zhixing Learning

An online teaching and learning platform for university students. Students register individual accounts and join an instructor course using its enrollment code. They can withdraw, study lessons, submit assignments, join discussions, take quizzes, and view grades. Instructors manage their own courses, upload videos, grade work, set grade weights, and monitor learning progress.

## Run locally

Requires Node.js 18 or later. No third-party packages are required.

    npm start

Open http://localhost:3000. A fresh database starts without accounts or courses. An instructor can register from the Instructor tab and create a course. To load sample courses for a private demonstration, set DEMO_SEED=1 before the first start. The optional demo account uses teacher@university.edu / Teacher123!. Never enable it on a public deployment.

Students register with a unique student ID and email address; instructors register with an email address and do not need a student ID. During signup, either role can enter a school code or exact school name to join an organization. Existing unlinked accounts can join from Personal Information. Each instructor sets a separate course code in Course Management. Both roles can update their name, gender, grade/year, and profile photo. A student ID is fixed after registration. Profile photos can be PNG, JPEG, or WebP files up to 3 MB.

## Administrator and password recovery

Create the global site administrator by setting a unique `ADMIN_EMAIL` and a strong `ADMIN_PASSWORD` (12–128 characters) before starting the server. No public administrator password is bundled. The Admin Portal also lets a school create its own administrator account and organization, with a chosen or generated school code. School administrators can review and manage only teachers, students, courses, and enrollments in their organization; the global administrator can manage all organizations. Existing accounts can bind to one school, and school membership cannot be moved from the profile page. Protect global credentials and use HTTPS outside local development.

Password recovery emails require a configured SMTP sender. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `PUBLIC_BASE_URL`. Until SMTP is configured, the site cannot deliver reset links; administrator password resets remain available. Never put SMTP or administrator secrets in a downloadable project archive.

## Courses and grades

- Instructors can add or remove lessons and upload MP4, WebM, or Ogg videos up to 80 MB each. Enrolled students can watch the videos.
- Instructors can create folders inside each lesson and upload study files. Enrolled students can download a complete folder as a ZIP archive.
- Instructors can create assignments, view submission counts, grade submissions, and leave feedback. Students can submit text and attach PDF, Word, plain-text, or image files up to 15 MB each.
- Instructors choose the weights for coursework, in-class assessments, midterms, and final exams; weights must add up to 100%. Graded assignments and the best quiz result can fill the first two components automatically, and instructors can override them. Overall grades are withheld until every weighted component has a score.
- A student sees their assignment-submission and quiz-attempt scores, together with course size and rank beside the overall score. Grade weights are shown only to instructors.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| PORT | Web server port | 3000 |
| HOST | Listen address | 0.0.0.0 |
| DATA_FILE | JSON data file | data/platform.json |
| UPLOAD_DIR | Video, assignment, and profile-photo storage | uploads/ beside the data file |
| DEMO_SEED | Set to 1 to create a demo instructor and sample courses on a new database | Disabled |
| DEMO_TEACHER_NAME | Optional demo instructor name | Instructor Lee |
| DEMO_TEACHER_EMAIL | Optional demo instructor email | teacher@university.edu |
| DEMO_TEACHER_PASSWORD | Optional demo instructor password | Teacher123! |
| TRUST_PROXY | Set to 1 to trust the proxy HTTPS header | Disabled |
| ADMIN_EMAIL / ADMIN_PASSWORD | Create the administrator when configured | No administrator |
| ADMIN_NAME | Administrator display name | Site Administrator |
| SMTP_HOST / SMTP_PORT | Outbound email server and port | Unconfigured |
| SMTP_USER / SMTP_PASS / SMTP_FROM | SMTP authentication and sender | Unconfigured |
| PUBLIC_BASE_URL | Base URL for password-reset links | Unconfigured |

Demo settings only apply when a database is created with DEMO_SEED=1. Use HTTPS and regular backups for a real deployment.

## Current limitations

This is a functional prototype. Records are stored in a local JSON file and uploads in local folders. A unique student ID is validated, but it is not verified against a school registry; connect the school SSO or student information system before using it for official records. Sessions are held in server memory, so users need to sign in again after a restart. Uploaded videos are not transcoded; browser playback depends on the video encoding.

## Verification

    node --check server.js
    node --check public/app.js
    node --check public/v2.js
    node --check public/profile.js
    node work/teacher-registration-test.js
    node work/v2-integration-test.js
    node work/v2-migration-test.js
    node work/profile-test.js
    node work/organization-test.js
