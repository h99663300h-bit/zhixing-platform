// Additional course enrollment, assignment, media, and gradebook views.
(() => {
  const gradeNames = { usual: 'Coursework', quiz: 'In-class Assessments', midterm: 'Midterm Exam', final: 'Final Exam' };
  const gradeKeys = Object.keys(gradeNames);
  state.lessonFolders = [];
  state.lessonResourcesFor = null;
  state.lessonFoldersLoading = false;
  const baseShell = shell;
  shell = function(content) {
    const teacher = state.user?.role === 'teacher';
    const extra = teacher ? navItem('grades', 'Grade Management', '◈') : navItem('enrollcode', 'Course Enrollment', '⊕') + navItem('grades', 'My Grades', '◈');
    const title = state.page === 'grades' ? (teacher ? 'Grade Management' : 'My Grades') : state.page === 'enrollcode' ? 'Course Enrollment' : '';
    let html = baseShell(content).replace('</nav>', extra + '</nav>');
    if (title) html = html.replace('<b>Learning Space</b>', '<b>' + esc(title) + '</b>');
    return html;
  };
  const baseCourseCard = courseCard;
  courseCard = function(course, teacher) {
    const html = baseCourseCard(course, teacher);
    return teacher ? html : html.replace('Open for Enrollment', 'Enroll with Code');
  };
  const baseTeacherManage = teacherManage;
  teacherManage = function() {
    let index = 0;
    return baseTeacherManage().replace(/<span class="meta">/g, () => {
      const course = state.courses.filter(c => (c.teacherId === state.user.id || (Array.isArray(c.teacherIds) && c.teacherIds.includes(state.user.id))))[index++];
      return '<span class="meta">Enrollment Code ' + esc(course?.enrollmentCode || 'Not generated') + ' · ';
    });
  };
  const baseModal = modal;
  modal = function() {
    if (state.modal?.type === 'assignment') return assignmentModal();
    if (state.modal?.type === 'submission-grade') return submissionGradeModal();
    let html = baseModal();
    if (state.modal?.type === 'course') {
      const field = '<div class="field"><label for="course-code">Course Enrollment Code</label><input id="course-code" name="enrollmentCode" value="' + esc(state.modal.course?.enrollmentCode || '') + '" maxlength="20" pattern="[A-Za-z0-9-]{4,20}" placeholder="Leave blank to generate automatically"><div class="field-hint">4–20 letters, numbers, or hyphens. Students need this code to join the course.</div></div>';
      return html.replace('<div class="field"><label for="course-color">', field + '<div class="field"><label for="course-color">');
    }
    if (state.modal?.type === 'lesson') {
      const field = '<div class="field"><label for="lesson-upload">Upload Video (Optional)</label><input id="lesson-upload" type="file" accept="video/mp4,video/webm,video/ogg"><div class="field-hint">MP4, WebM, or OGG. The video uploads when you save the lesson.</div></div>';
      const boundary = '</div><div class="modal-actions">';
      const offset = html.lastIndexOf(boundary);
      return offset < 0 ? html : html.slice(0, offset) + field + html.slice(offset);
    }
    return html;
  };
  const baseRender = render;
  render = function() {
    if (!state.user) return baseRender();
    if (state.page === 'enrollcode') { app.innerHTML = shell(enrollPage()); return; }
    if (state.page === 'grades') { app.innerHTML = shell(gradesPage()); return; }
    return baseRender();
  };
  const baseNavigate = navigate;
  navigate = async function(page) {
    if (page === 'grades' && state.user?.role === 'student') {
      const data = await api('/api/student/grades');
      state.myGrades = data.courses || [];
    }
    await baseNavigate(page);
  };
  function enrollPage() {
    const enrolled = state.courses.filter(c => c.enrolled);
    return `<div class="page-head"><div><div class="eyebrow">COURSE ENROLLMENT</div><h1>Course Enrollment</h1><p>Enter the code provided by your teacher to join a course.</p></div></div><section class="panel panel-pad code-panel"><div class="code-icon">⌘</div><div><h2>Join a Course with a Code</h2><p class="muted small">Each course has a unique code set by its teacher. Ask your teacher for the code.</p><form id="enroll-code-form" class="code-form"><label for="enroll-code">Course Code</label><div class="row"><input id="enroll-code" name="code" placeholder="e.g., ABCD-2026" minlength="4" maxlength="20" autocomplete="off" required><button class="btn btn-primary" type="submit">Join Course →</button></div></form></div></section><div class="section-head"><div><h2>Enrolled Courses</h2><p>View or withdraw from your courses at any time</p></div><span class="pill blue">${enrolled.length} courses</span></div>${enrolled.length ? enrolled.map(c => `<div class="panel enroll-row"><div><strong>${esc(c.title)}</strong><p class="small muted">${esc(c.teacherName || 'Teacher')} · Progress: ${percent(c.progress)}</p></div><div class="row wrap"><button class="btn btn-soft btn-sm" data-action="open-course" data-id="${esc(c.id)}">Open Course</button><button class="btn btn-danger btn-sm" data-action="unenroll" data-id="${esc(c.id)}">Withdraw</button></div></div>`).join('') : em('No enrolled courses yet', 'Enter a course code to start learning.')}`;
  }
  function gradesPage() {
    if (['teacher','admin'].includes(state.user.role)) {
      const courses = state.courses.filter(c => (c.teacherId === state.user.id || (Array.isArray(c.teacherIds) && c.teacherIds.includes(state.user.id))));
      return `<div class="page-head"><div><div class="eyebrow">GRADE MANAGEMENT</div><h1>Grade Management</h1><p>Set grade weights and record coursework, in-class assessment, midterm, and final exam scores for each course.</p></div></div>${courses.length ? courses.map(c => `<div class="panel enroll-row"><div><strong>${esc(c.title)}</strong><p class="small muted">${n(c.studentCount)} students · Enrollment Code ${esc(c.enrollmentCode || 'Not generated')}</p></div><button class="btn btn-primary btn-sm" data-action="open-course-tab" data-id="${esc(c.id)}" data-tab="gradebook">Open Gradebook →</button></div>`).join('') : em('No courses yet','Create a course to set up its gradebook.')}`;
    }
    return `<div class="page-head"><div><div class="eyebrow">MY GRADES</div><h1>My Grades</h1><p>View your assessment results, class rank, and overall grade for each enrolled course.</p></div></div>${state.myGrades.length ? state.myGrades.map(g => studentGradeCard(g)).join('') : em('No grades yet','Grades will appear here after you join a course and complete assessments.')}`;
  }
  function studentGradeCard(g) {
    const classSize = Number.isInteger(g.classSize) ? g.classSize : 0;
    const rank = Number.isInteger(g.rank) ? g.rank : null;
    const assignments = Array.isArray(g.assignments) ? g.assignments : [];
    const quizzes = Array.isArray(g.quizAttempts) ? g.quizAttempts : [];
    const assignmentRows = assignments.map(a => `<div class="assessment-row"><div><strong>${esc(a.title || 'Assignment')}</strong><small>Submitted ${fmtDate(a.submittedAt)}</small>${a.feedback ? `<small>Teacher feedback: ${esc(a.feedback)}</small>` : ''}</div><b>${a.score == null ? 'Awaiting grade' : `${esc(a.score)} / ${esc(a.maxScore)}`}</b></div>`).join('');
    const quizRows = quizzes.map(a => `<div class="assessment-row"><div><strong>${esc(a.title || 'Course Quiz')}</strong><small>Submitted ${fmtDate(a.submittedAt)}</small></div><b>${esc(a.score)} / ${esc(a.total)} · ${percent(a.percent)}</b></div>`).join('');
    return `<section class="panel panel-pad grade-card"><div class="row-between"><div><h2>${esc(g.courseTitle)}</h2><p class="muted small">Your course results and assessment history</p></div><div class="grade-summary"><span class="grade-total">${g.total == null ? 'Not published' : esc(Number(g.total).toFixed(1))}</span><span class="grade-rank">Rank ${rank == null ? '—' : esc(rank)}/${esc(classSize)}</span></div></div><div class="grade-grid">${gradeKeys.map(key => `<div class="grade-cell"><span>${gradeNames[key]}</span><strong>${g.scores?.[key] == null ? 'Awaiting score' : esc(g.scores[key])}</strong>${['assignments','quiz'].includes(g.sources?.[key]) ? '<em>Calculated automatically</em>' : ''}</div>`).join('')}</div><div class="assessment-history"><div><h3>Assignment Scores</h3>${assignmentRows || '<p class="small muted">No submitted assignments yet.</p>'}</div><div><h3>Quiz Attempts</h3>${quizRows || '<p class="small muted">No quiz attempts yet.</p>'}</div></div></section>`;
  }
  const baseLoadTabData = loadTabData;
  loadTabData = async function(tab) {
    await baseLoadTabData(tab);
    if (!state.selectedCourse) return;
    const courseId = encodeURIComponent(state.selectedCourse.id);
    if (tab === 'assignments') {
      if (state.user.role === 'student' && !state.selectedCourse.enrolled) return;
      const data = await api('/api/courses/' + courseId + '/assignments');
      state.assignments = data.assignments || [];
      state.submissions = [];
      state.assignmentSelected = null;
    }
    if (tab === 'gradebook' && ['teacher','admin'].includes(state.user.role)) {
      state.gradebook = await api('/api/courses/' + courseId + '/gradebook');
    }
  };
  const baseDetailPage = detailPage;
  detailPage = function() {
    if (!state.selectedCourse) return baseDetailPage();
    const teacher = ['teacher','admin'].includes(state.user.role);
    let html = baseDetailPage();
    const tab = state.activeTab;
    const tabButtons = `<button class="tab ${tab === 'assignments' ? 'active' : ''}" data-action="detail-tab" data-tab="assignments">Assignment Management</button>${teacher ? `<button class="tab ${tab === 'gradebook' ? 'active' : ''}" data-action="detail-tab" data-tab="gradebook">Gradebook</button>` : ''}`;
    html = html.replace(/(<button class="tab [^"]*" data-action="detail-tab" data-tab="discussion">[^<]*<\/button>)/, '$1' + tabButtons);
    const selectedPanel = tab === 'assignments' ? assignmentPanel() : tab === 'gradebook' && teacher ? gradebookPanel() : null;
    if (selectedPanel !== null) {
      const contentEnd = '</section><aside class="panel panel-pad teacher-side">';
      const idx = html.indexOf('<div class="tabs">');
      const end = html.indexOf(contentEnd, idx);
      if (idx >= 0 && end >= 0) {
        const tabsEnd = html.indexOf('</div>', idx) + '</div>'.length;
        html = html.slice(0, tabsEnd) + selectedPanel + html.slice(end);
      }
    }
    if (teacher) {
      const code = '<div class="course-code"><span>Enrollment code for this course</span><strong>' + esc(state.selectedCourse.enrollmentCode || 'Not generated') + '</strong><small>Share this code only with students in this course</small></div>';
      html = html.replace('<div class="detail-layout">', code + '<div class="detail-layout">');
    } else {
      html = html.replaceAll('data-action="enroll"', 'data-action="show-enroll-code"');
      if (state.selectedCourse.enrolled) html = html.replace('<div class="detail-layout">', '<div class="row" style="justify-content:flex-end;margin:10px 0 16px"><button class="btn btn-danger btn-sm" data-action="unenroll" data-id="' + esc(state.selectedCourse.id) + '">Withdraw from This Course</button></div><div class="detail-layout">');
    }
    return html;
  };
  const baseLessonView = lessonView;
  lessonView = function(course, lesson) {
    let html = baseLessonView(course, lesson);
    if (lesson?.videoFileUrl) {
      const video = `<div class="video-uploaded"><p class="small muted">Teacher-uploaded video</p><video class="lesson-video" controls preload="metadata" src="${esc(lesson.videoFileUrl)}">Your browser does not support video playback.</video></div>`;
      html = html.replace('</section>', video + '</section>');
    }
    if (lesson && (['teacher','admin'].includes(state.user.role) || course.enrolled)) {
      html = html.replace('</section>', lessonResourcesPanel(lesson.id) + '</section>');
    }
    return html;
  };
  function lessonResourcesPanel(lessonId) {
    const teacher = ['teacher','admin'].includes(state.user.role);
    const loaded = state.lessonResourcesFor === lessonId;
    const folders = loaded ? state.lessonFolders : [];
    const list = state.lessonFoldersLoading || !loaded
      ? '<p class="small muted">Loading lesson files…</p>'
      : folders.length ? folders.map(folder => lessonFolderCard(lessonId, folder, teacher)).join('')
        : '<p class="small muted">No lesson folders have been added yet.</p>';
    const create = teacher ? `<form id="lesson-folder-form" class="lesson-folder-create" data-lesson-id="${esc(lessonId)}"><label for="lesson-folder-name">New Folder</label><div class="row"><input id="lesson-folder-name" name="name" maxlength="80" placeholder="e.g., Week 1 Reading" required><button class="btn btn-soft btn-sm" type="submit">Create Folder</button></div></form>` : '';
    return `<div class="lesson-resources"><div class="row-between"><div><h3>Lesson Files</h3><p class="small muted">${teacher ? 'Organize course materials in folders for your students.' : 'Download a complete folder as a ZIP file.'}</p></div></div>${create}<div class="lesson-folder-list">${list}</div></div>`;
  }
  function lessonFolderCard(lessonId, folder, teacher) {
    const folderId = esc(folder.id);
    const fileRows = (folder.files || []).map(file => `<div class="lesson-file-row"><span>▤ ${esc(file.name)}</span><span class="small muted">${formatBytes(file.size)}</span>${teacher ? `<button type="button" class="btn btn-danger btn-sm" data-action="delete-lesson-file" data-lesson-id="${esc(lessonId)}" data-folder-id="${folderId}" data-id="${esc(file.id)}" aria-label="Delete ${esc(file.name)}">Delete</button>` : ''}</div>`).join('');
    const download = (folder.files || []).length ? `<a class="btn btn-soft btn-sm" href="/api/lessons/${encodeURIComponent(lessonId)}/folders/${encodeURIComponent(folder.id)}/download" download>Download Folder (.zip)</a>` : '';
    const controls = teacher ? `<button type="button" class="btn btn-danger btn-sm" data-action="delete-lesson-folder" data-lesson-id="${esc(lessonId)}" data-id="${folderId}">Delete Folder</button>` : '';
    const upload = teacher ? `<form class="lesson-file-upload" data-lesson-id="${esc(lessonId)}" data-folder-id="${folderId}"><label for="lesson-files-${folderId}">Add Files</label><div class="row"><input id="lesson-files-${folderId}" type="file" name="files" multiple accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp,.zip" required><button class="btn btn-primary btn-sm" type="submit">Upload Files</button></div><p class="tiny muted">Up to 15 MB per file, maximum 50 files in a folder.</p></form>` : '';
    return `<section class="lesson-folder-card"><div class="row-between"><div><strong>▣ ${esc(folder.name)}</strong><p class="tiny muted">${(folder.files || []).length} files</p></div><div class="row wrap">${download}${controls}</div></div>${fileRows || '<p class="small muted">This folder is empty.</p>'}${upload}</section>`;
  }
  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  async function refreshLessonFolders(lessonId) {
    const data = await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders');
    if (state.activeLesson !== lessonId) return;
    state.lessonFolders = Array.isArray(data.folders) ? data.folders : [];
    state.lessonResourcesFor = lessonId;
    state.lessonFoldersLoading = false;
    render();
  }
  function gradebookPanel() {
    const book = state.gradebook || { weights: {}, students: [] };
    return `<div class="row-between"><div><h3>${esc(state.selectedCourse.title)} · Gradebook</h3><p class="small muted">Grade weights must add up to 100%. The overall grade stays unpublished until all weighted scores are entered.</p></div></div><form id="weights-form" class="weights-form"><div class="grade-grid">${gradeKeys.map(key => `<label class="grade-cell">${gradeNames[key]}<input type="number" name="${key}" min="0" max="100" step="0.1" value="${esc(book.weights?.[key] ?? 0)}" required><small>%</small></label>`).join('')}</div><button type="submit" class="btn btn-primary btn-sm">Save Grade Weights</button></form><div class="section-head"><div><h3>Student Scores</h3><p>Assessment and coursework scores can be calculated from quizzes and assignments, or overridden by the teacher.</p></div></div>${book.students?.length ? book.students.map(studentScoreRow).join('') : em('No students enrolled yet','Students will appear here after joining with the course code.')}`;
  }
  function studentScoreRow(s) {
    return `<form class="grade-student-form panel" data-user-id="${esc(s.userId)}"><div class="row-between"><div><strong>${esc(s.name)} · ${esc(s.studentId)}</strong><p class="small muted">Assignment average ${s.assignmentAverage == null ? 'N/A' : esc(s.assignmentAverage)} · Best quiz score ${s.quizBest == null ? 'N/A' : esc(s.quizBest)}</p></div><span class="grade-total">${s.total == null ? 'Not published' : esc(Number(s.total).toFixed(1))}</span></div><div class="grade-grid">${gradeKeys.map(key => `<label class="grade-cell">${gradeNames[key]}<input name="${key}" type="number" min="0" max="100" step="0.1" value="${s.sources?.[key] === 'teacher' ? esc(s.scores?.[key]) : ''}" placeholder="${s.scores?.[key] == null ? 'Not graded' : 'Auto: ' + esc(s.scores[key])}">${['assignments','quiz'].includes(s.sources?.[key]) ? '<small>Calculated automatically; you can override it</small>' : ''}</label>`).join('')}</div><div class="row" style="justify-content:flex-end"><button class="btn btn-soft btn-sm" type="submit">Save Student Grades</button></div></form>`;
  }
  function assignmentPanel() {
    const teacher = ['teacher','admin'].includes(state.user.role);
    if (!teacher && !state.selectedCourse.enrolled) return em('Join the course to submit assignments', 'Enter the code from your teacher in Course Enrollment.', '<button class="btn btn-primary" data-action="show-enroll-code">Go to Course Enrollment →</button>');
    const cards = state.assignments.map(a => assignmentCard(a, teacher)).join('');
    return `<div class="row-between" style="margin-bottom:18px"><div><h3 style="margin:0">${teacher ? 'Assignment Management' : 'Course Assignments'}</h3><p class="tiny muted">${teacher ? 'Create assignments, track submissions, and grade student work' : 'Submit text or a file, and view teacher feedback and grades'}</p></div>${teacher ? '<button class="btn btn-soft btn-sm" data-action="new-assignment">＋ Create Assignment</button>' : ''}</div>${cards || em('No assignments yet', teacher ? 'Create an assignment to start collecting student work.' : 'Assignments will appear here when your teacher posts them.')}${teacher && state.assignmentSelected ? submissionsPanel() : ''}`;
  }
  function assignmentCard(a, teacher) {
    const sub = a.submission;
    const deadline = a.dueAt ? fmtDate(a.dueAt) : 'No due date';
    const actions = teacher ? `<div class="row wrap"><button class="btn btn-light btn-sm" data-action="edit-assignment" data-id="${esc(a.id)}">Edit</button><button class="btn btn-danger btn-sm" data-action="delete-assignment" data-id="${esc(a.id)}">Delete</button></div>` : '';
    let below;
    if (teacher) below = `<div class="row-between assignment-stats"><span>Submitted: ${n(a.stats?.submitted)} / ${n(a.stats?.totalStudents)} · Graded: ${n(a.stats?.graded)}</span><button class="btn btn-soft btn-sm" data-action="view-submissions" data-id="${esc(a.id)}">View Submissions and Grades →</button></div>`;
    else {
      const fileLink = sub?.fileUrl ? `<a class="file-link" href="${esc(sub.fileUrl)}" target="_blank" rel="noopener">View submitted file: ${esc(sub.fileName)}</a>` : '';
      const status = sub ? `<p class="small">Submitted on ${fmtDate(sub.submittedAt)} · ${sub.score == null ? 'Awaiting grading' : 'Score: ' + esc(sub.score) + ' / ' + esc(a.maxScore)}${sub.feedback ? '<br>Teacher feedback: ' + esc(sub.feedback) : ''}</p>${fileLink}` : '<p class="small muted">Not submitted</p>';
      below = `<div class="assignment-submission">${status}<form class="assignment-submit-form" data-assignment-id="${esc(a.id)}"><label>Assignment Response (Optional)</label><textarea name="content" maxlength="30000" placeholder="Type your response or upload a file below">${esc(sub?.content || '')}</textarea><label>Assignment File (Optional)</label><input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"><button class="btn btn-primary btn-sm" type="submit">${sub ? 'Resubmit Assignment' : 'Submit Assignment'}</button></form></div>`;
    }
    return `<article class="assignment-card"><div class="row-between"><div><span class="pill blue">Assignment · ${esc(a.maxScore)} points</span><h3>${esc(a.title)}</h3><p class="small muted">${esc(a.instructions || 'No instructions have been added yet.')}</p><p class="tiny muted">Due: ${esc(deadline)}</p></div>${actions}</div>${below}</article>`;
  }
  function submissionsPanel() {
    const a = state.assignments.find(x => x.id === state.assignmentSelected);
    if (!a) return '';
    const rows = state.submissions.map(s => {
      const file = s.fileUrl ? `<a class="file-link" href="${esc(s.fileUrl)}" target="_blank" rel="noopener">View assignment file: ${esc(s.fileName)} ↗</a>` : '';
      return `<article class="submission-row"><div><strong>${esc(s.studentName)} · ${esc(s.studentId)}</strong><p class="small muted">${fmtDate(s.submittedAt)} · ${s.score == null ? 'Awaiting grading' : 'Score: ' + esc(s.score) + ' / ' + esc(a.maxScore)}</p><p class="small">${esc(s.content || 'File submitted without a written response')}</p>${file}${s.feedback ? '<p class="small muted">Teacher feedback: ' + esc(s.feedback) + '</p>' : ''}</div><button class="btn btn-soft btn-sm" data-action="grade-submission" data-id="${esc(s.id)}">${s.score == null ? 'Grade Assignment' : 'Edit Grade'}</button></article>`;
    }).join('');
    return `<section class="panel panel-pad submissions-panel"><div class="row-between"><div><h3>${esc(a.title)} · Submission Summary</h3><p class="small muted">Submitted: ${n(a.stats?.submitted)} / ${n(a.stats?.totalStudents)} · Graded: ${n(a.stats?.graded)}</p></div><button class="btn btn-light btn-sm" data-action="hide-submissions">Hide</button></div>${rows || em('No submissions yet','Student submissions will appear here for review and grading.')}</section>`;
  }
  function assignmentModal() {
    const a = state.modal.assignment || {};
    const date = a.dueAt ? new Date(a.dueAt) : null;
    const localDue = date && !isNaN(date) ? new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
    return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${a.id ? 'Edit Assignment' : 'Create Assignment'}</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div><form id="assignment-form"><div class="modal-body"><div class="field"><label for="assignment-title">Assignment Title *</label><input id="assignment-title" name="title" value="${esc(a.title)}" maxlength="120" required></div><div class="field"><label for="assignment-instructions">Instructions *</label><textarea id="assignment-instructions" name="instructions" rows="6" required>${esc(a.instructions)}</textarea></div><div class="form-grid"><div class="field"><label for="assignment-due">Due Date and Time</label><input id="assignment-due" name="dueAt" type="datetime-local" value="${esc(localDue)}"></div><div class="field"><label for="assignment-max">Maximum Score</label><input id="assignment-max" name="maxScore" type="number" min="1" max="1000" step="0.1" value="${esc(a.maxScore ?? 100)}" required></div></div></div><div class="modal-actions"><button class="btn btn-light" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save Assignment</button></div></form></div></div>`;
  }
  function submissionGradeModal() {
    const s = state.modal.submission;
    const a = state.assignments.find(x => x.id === state.assignmentSelected);
    return `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Grade ${esc(s.studentName)}'s assignment</h2><button class="icon-btn" data-action="close-modal" aria-label="Close">✕</button></div><form id="submission-grade-form"><div class="modal-body"><p class="small muted">${esc(a?.title)} · Maximum score: ${esc(a?.maxScore)}</p><div class="field"><label>Score: *</label><input name="score" type="number" min="0" max="${esc(a?.maxScore)}" step="0.1" value="${esc(s.score ?? '')}" required></div><div class="field"><label>Feedback</label><textarea name="feedback" rows="5" maxlength="2000">${esc(s.feedback || '')}</textarea></div></div><div class="modal-actions"><button class="btn btn-light" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save Grade</button></div></form></div></div>`;
  }
  async function refreshAssignments() {
    const data = await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/assignments');
    state.assignments = data.assignments || [];
  }
  async function refreshGradebook() {
    state.gradebook = await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook');
  }
  async function uploadFile(endpoint, file) {
    const limit = endpoint.includes('/video') ? 80 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > limit) throw new Error(endpoint.includes('/video') ? 'Video files must not exceed 80 MB' : 'Assignment files must not exceed 15 MB');
    const ext = file.name.toLowerCase().split('.').pop();
    const fallback = {mp4:'video/mp4',webm:'video/webm',ogg:'video/ogg',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'};
    const contentType = fallback[ext] || file.type || 'application/octet-stream';
    const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': contentType, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'File upload failed');
    return result;
  }
  document.addEventListener('click', event => {
    const node = event.target.closest('[data-action]');
    if (!node || !state.user) return;
    const action = node.dataset.action;
    const id = node.dataset.id;
    if (action === 'open-lesson') {
      event.preventDefault(); event.stopImmediatePropagation();
      state.activeLesson = id;
      state.lessonFolders = [];
      state.lessonResourcesFor = null;
      state.lessonFoldersLoading = true;
      render();
      setTimeout(() => $('.lesson-open')?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 0);
      if (['teacher','admin'].includes(state.user.role) || state.selectedCourse?.enrolled) {
        run(async () => {
          try { await refreshLessonFolders(id); }
          catch (error) {
            if (state.activeLesson === id) { state.lessonFoldersLoading = false; state.lessonResourcesFor = id; render(); }
            throw error;
          }
        }, 'Could not load lesson files: ');
      }
      return;
    }
    if (action === 'delete-lesson-folder') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('Delete this folder and all its files?')) return;
      const lessonId = node.dataset.lessonId;
      run(async () => {
        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders/' + encodeURIComponent(id), { method:'DELETE' });
        await refreshLessonFolders(lessonId);
        showToast('Folder deleted');
      }, 'Could not delete folder: ');
      return;
    }
    if (action === 'delete-lesson-file') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('Delete this file?')) return;
      const lessonId = node.dataset.lessonId;
      run(async () => {
        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders/' + encodeURIComponent(node.dataset.folderId) + '/files/' + encodeURIComponent(id), { method:'DELETE' });
        await refreshLessonFolders(lessonId);
        showToast('File deleted');
      }, 'Could not delete file: ');
      return;
    }
    if (action === 'show-enroll-code') {
      event.preventDefault(); event.stopImmediatePropagation();
      run(() => navigate('enrollcode'));
    }
    if (action === 'unenroll') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('Withdraw from this course? You will lose access to its materials; past grades and assignments will no longer appear.')) return;
      run(async () => {
        await api('/api/courses/' + encodeURIComponent(id) + '/unenroll', { method: 'POST', body: '{}' });
        await refreshCourses();
        state.selectedCourse = null;
        state.page = 'enrollcode';
        render(); showToast('You have withdrawn from the course');
      }, 'Withdrawal failed: ');
    }
    if (action === 'open-course-tab') {
      event.preventDefault(); event.stopImmediatePropagation();
      run(() => loadCourse(id, node.dataset.tab || 'lessons'));
    }
    if (action === 'new-assignment' || action === 'edit-assignment') {
      event.preventDefault(); event.stopImmediatePropagation();
      state.modal = { type: 'assignment', assignment: action === 'edit-assignment' ? state.assignments.find(a => a.id === id) : null };
      render();
    }
    if (action === 'delete-assignment') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!confirm('Delete this assignment and all student submissions?')) return;
      run(async () => {
        await api('/api/assignments/' + encodeURIComponent(id), { method: 'DELETE' });
        if (state.assignmentSelected === id) state.assignmentSelected = null;
        await refreshAssignments(); render(); showToast('Assignment deleted');
      }, 'Could not delete assignment: ');
    }
    if (action === 'view-submissions') {
      event.preventDefault(); event.stopImmediatePropagation();
      run(async () => {
        state.assignmentSelected = id;
        const data = await api('/api/assignments/' + encodeURIComponent(id) + '/submissions');
        state.submissions = data.submissions || [];
        render();
      }, 'Could not load submissions: ');
    }
    if (action === 'hide-submissions') {
      event.preventDefault(); event.stopImmediatePropagation();
      state.assignmentSelected = null; state.submissions = []; render();
    }
    if (action === 'grade-submission') {
      event.preventDefault(); event.stopImmediatePropagation();
      state.modal = { type: 'submission-grade', submission: state.submissions.find(s => s.id === id) };
      render();
    }
  }, true);
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!state.user) return;
    if (form.id === 'lesson-folder-form') {
      event.preventDefault(); event.stopImmediatePropagation();
      const lessonId = form.dataset.lessonId;
      const name = String(new FormData(form).get('name') || '').trim();
      if (!name) { showToast('Enter a folder name', true); return; }
      run(async () => {
        await api('/api/lessons/' + encodeURIComponent(lessonId) + '/folders', { method:'POST', body:JSON.stringify({name}) });
        await refreshLessonFolders(lessonId);
        showToast('Folder created');
      }, 'Could not create folder: ');
      return;
    }
    if (form.classList.contains('lesson-file-upload')) {
      event.preventDefault(); event.stopImmediatePropagation();
      const lessonId = form.dataset.lessonId;
      const folderId = form.dataset.folderId;
      const files = Array.from(form.querySelector('input[type=file]')?.files || []);
      const folder = state.lessonFolders.find(x => x.id === folderId);
      if (!files.length) { showToast('Choose files to upload', true); return; }
      const allowedExtensions = new Set(['pdf','doc','docx','ppt','pptx','xls','xlsx','txt','csv','png','jpg','jpeg','webp','zip']);
      if (files.some(file => !allowedExtensions.has(file.name.toLowerCase().split('.').pop()))) { showToast('Only PDF, Word, PowerPoint, Excel, text, image, or ZIP files are supported', true); return; }
      if ((folder?.files?.length || 0) + files.length > 50) { showToast('A folder can contain at most 50 files', true); return; }
      if (files.some(file => file.size > 15 * 1024 * 1024)) { showToast('Each file must be 15 MB or less', true); return; }
      run(async () => {
        const types = {pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain',csv:'text/csv',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',zip:'application/zip'};
        for (const file of files) {
          const extension = file.name.toLowerCase().split('.').pop();
          const response = await fetch('/api/lessons/' + encodeURIComponent(lessonId) + '/folders/' + encodeURIComponent(folderId) + '/files', {method:'POST',credentials:'same-origin',headers:{'Content-Type':types[extension] || file.type || 'application/octet-stream','X-File-Name':encodeURIComponent(file.name)},body:file});
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            await refreshLessonFolders(lessonId);
            throw new Error(result.error || `Could not upload ${file.name}`);
          }
        }
        await refreshLessonFolders(lessonId);
        showToast(`${files.length} file${files.length === 1 ? '' : 's'} uploaded`);
      }, 'File upload failed: ');
      return;
    }
    if (form.id === 'course-form') {
      const code = form.querySelector('[name="enrollmentCode"]');
      if (code && !code.value.trim()) code.disabled = true;
      return;
    }
    if (form.id === 'lesson-form') {
      const file = form.querySelector('#lesson-upload')?.files?.[0];
      if (!file) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (file.size > 80 * 1024 * 1024) { showToast('Video files must not exceed 80 MB', true); return; }
      if (!['mp4','webm','ogg'].includes(file.name.toLowerCase().split('.').pop())) { showToast('Only MP4, WebM, or OGG videos are supported', true); return; }
      const data = Object.fromEntries(new FormData(form));
      const current = state.modal?.lesson;
      run(async () => {
        const endpoint = current?.id ? '/api/lessons/' + encodeURIComponent(current.id) : '/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/lessons';
        const response = await api(endpoint, { method:current?.id ? 'PATCH' : 'POST', body:JSON.stringify(data) });
        const lessonId = response.lesson?.id || current?.id;
        await uploadFile('/api/lessons/' + encodeURIComponent(lessonId) + '/video', file);
        state.modal = null; await refreshCourses(); await reloadSelected(); showToast('Lesson and video saved');
      }, 'Video upload failed: ');
      return;
    }
    if (form.id === 'enroll-code-form') {
      event.preventDefault(); event.stopImmediatePropagation();
      const code = new FormData(form).get('code')?.toString().trim();
      run(async () => {
        const data = await api('/api/courses/enroll-by-code', { method:'POST', body:JSON.stringify({code}) });
        await refreshCourses();
        showToast('Course joined. You can start learning now!');
        await loadCourse(data.course.id);
      }, 'Could not join course: ');
    }
    if (form.id === 'assignment-form') {
      event.preventDefault(); event.stopImmediatePropagation();
      const data = Object.fromEntries(new FormData(form));
      data.maxScore = Number(data.maxScore);
      data.dueAt = data.dueAt ? new Date(data.dueAt).toISOString() : '';
      const existing = state.modal?.assignment;
      run(async () => {
        const endpoint = existing?.id ? '/api/assignments/' + encodeURIComponent(existing.id) : '/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/assignments';
        await api(endpoint, { method: existing?.id ? 'PATCH' : 'POST', body:JSON.stringify(data) });
        state.modal = null; await refreshAssignments(); render(); showToast('Assignment saved');
      }, 'Could not save assignment: ');
    }
    if (form.classList.contains('assignment-submit-form')) {
      event.preventDefault(); event.stopImmediatePropagation();
      const fd = new FormData(form);
      const content = String(fd.get('content') || '').trim();
      const file = fd.get('file');
      if (!content && !(file instanceof File && file.size)) { showToast('Enter a response or select a file', true); return; }
      if (file instanceof File && file.size > 15 * 1024 * 1024) { showToast('Assignment files must not exceed 15 MB', true); return; }
      const assignmentId = form.dataset.assignmentId;
      run(async () => {
        await api('/api/assignments/' + encodeURIComponent(assignmentId) + '/submit', { method:'POST', body:JSON.stringify({content}) });
        if (file instanceof File && file.size) await uploadFile('/api/assignments/' + encodeURIComponent(assignmentId) + '/submission/file', file);
        await refreshAssignments(); render(); showToast('Assignment submitted');
      }, 'Could not submit assignment: ');
    }
    if (form.id === 'submission-grade-form') {
      event.preventDefault(); event.stopImmediatePropagation();
      const values = Object.fromEntries(new FormData(form));
      const submissionId = state.modal?.submission?.id;
      run(async () => {
        await api('/api/submissions/' + encodeURIComponent(submissionId) + '/grade', { method:'PATCH', body:JSON.stringify({ score:Number(values.score), feedback:values.feedback }) });
        state.modal = null;
        const data = await api('/api/assignments/' + encodeURIComponent(state.assignmentSelected) + '/submissions');
        state.submissions = data.submissions || [];
        await refreshAssignments(); await refreshGradebook(); render(); showToast('Grade saved and synced to the gradebook');
      }, 'Could not save grade: ');
    }
    if (form.id === 'weights-form') {
      event.preventDefault(); event.stopImmediatePropagation();
      const raw = Object.fromEntries(new FormData(form));
      const weights = Object.fromEntries(gradeKeys.map(key => [key, Number(raw[key])]));
      if (Math.abs(Object.values(weights).reduce((a,b)=>a+b,0) - 100) > 0.000001) { showToast('The four grade weights must add up to 100%', true); return; }
      run(async () => {
        await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/weights', {method:'PUT',body:JSON.stringify({weights})});
        await refreshGradebook(); render(); showToast('Grade weights updated');
      }, 'Could not save grade weights: ');
    }
    if (form.classList.contains('grade-student-form')) {
      event.preventDefault(); event.stopImmediatePropagation();
      const raw = Object.fromEntries(new FormData(form));
      const scores = Object.fromEntries(gradeKeys.map(key => [key, raw[key] === '' ? null : Number(raw[key])]));
      run(async () => {
        await api('/api/courses/' + encodeURIComponent(state.selectedCourse.id) + '/gradebook/' + encodeURIComponent(form.dataset.userId), {method:'PATCH',body:JSON.stringify({scores})});
        await refreshGradebook(); render(); showToast('Student grades updated');
      }, 'Could not save grades: ');
    }
  }, true);
})();
