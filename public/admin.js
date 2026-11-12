// Administrator workspace and email password recovery. Loaded after the standard UI extensions.
(() => {
  const originalAuthPage = authPage;
  const originalRender = render;
  let resetToken = new URLSearchParams(location.search).get('reset') || '';
  let resetNotice = '';
  let adminData = null;
  let adminLoading = false;
  let adminError = '';
  let adminTab = 'teachers';
  let adminDialog = null;

  if (resetToken) {
    // Never leave the one-use token visible in browser history after opening the email link.
    history.replaceState(null, '', location.pathname + location.hash);
    state.authMode = 'reset';
  }

  function authRecoveryPage() {
    const resetting = state.authMode === 'reset';
    const heading = resetting ? 'Set a New Password' : 'Forgot Your Password?';
    const explanation = resetting
      ? 'Choose a new password for your account. The link in your email can only be used once.'
      : 'Enter your account email. If it is registered, we will send a password reset link.';
    const fields = resetting
      ? '<div class="field"><label for="new-password">New Password</label><input id="new-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div>' +
        '<div class="field"><label for="confirm-password">Confirm New Password</label><input id="confirm-password" name="confirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></div>'
      : '<div class="field"><label for="recovery-email">Email Address</label><input id="recovery-email" name="email" type="email" placeholder="you@example.com" autocomplete="email" required></div>';
    return '<div class="auth-layout"><section class="auth-brand-panel">' + brand() +
      '<div class="auth-promo"><div class="eyebrow">ACCOUNT ACCESS</div><h1>Get back to learning.</h1><p>Secure account recovery for students, instructors, and administrators.</p></div>' +
      '<footer>© ' + new Date().getFullYear() + ' Zhixing Learning</footer></section>' +
      '<section class="auth-form-panel"><div class="auth-topnav"><button type="button" data-admin-action="back-to-login">Back to Sign In →</button></div>' +
      '<div class="auth-form-wrap"><div class="eyebrow">ACCOUNT RECOVERY</div><h2>' + heading + '</h2><p class="intro">' + explanation + '</p>' +
      (resetNotice ? '<div class="panel panel-pad small" role="status" style="margin-bottom:17px">' + esc(resetNotice) + '</div>' : '') +
      '<form id="' + (resetting ? 'admin-reset-confirm' : 'admin-reset-request') + '">' + fields +
      '<button class="btn btn-primary auth-submit" type="submit">' + (resetting ? 'Save New Password' : 'Send Reset Link') + '</button></form>' +
      '<p class="auth-bottom">' + (resetting ? 'Need another link?' : 'Remembered your password?') +
      ' <button type="button" data-admin-action="' + (resetting ? 'forgot' : 'back-to-login') + '">' +
      (resetting ? 'Request a New Link' : 'Sign In') + '</button></p></div></section></div>';
  }

  authPage = function() {
    if (state.authMode === 'forgot' || state.authMode === 'reset') return authRecoveryPage();
    let html = originalAuthPage();
    if (state.authMode === 'register') {
      const start = html.indexOf('<div class="auth-role"');
      const end = start < 0 ? -1 : html.indexOf('</div>', start);
      if (end >= 0) {
        let roleBar = html.slice(start, end);
        roleBar = roleBar.replace('class="auth-role"', 'class="auth-role" style="grid-template-columns:repeat(3,minmax(0,1fr))"');
        roleBar = roleBar.replace(/class="[^"]*" data-action="auth-role" data-role="(student|teacher)"/g, (match, role) => match.replace(/class="[^"]*"/, 'class="' + (state.authRole === role ? 'active' : '') + '"'));
        roleBar += '<button type="button" class="' + (state.authRole === 'admin' ? 'active' : '') + '" data-action="auth-role" data-role="admin">⚙ Administrator</button>';
        html = html.slice(0, start) + roleBar + html.slice(end);
      }
      if (state.authRole !== 'admin') {
        html = html.replace('<div class="field"><label for="auth-email">Email Address</label>', '<div class="field"><label for="auth-school">School / Organization (optional)</label><input id="auth-school" name="school" maxlength="100" placeholder="Enter a school code or exact school name"><div class="field-hint">For example: 1008611 or Peking University. You can join later from your profile.</div></div><div class="field"><label for="auth-email">Email Address</label>');
      } else {
        html = html.replace('Create Your Teaching Workspace', 'Create a School Organization');
        html = html.replace('Create an instructor account, then create courses and share enrollment codes with students.', 'Create your school organization and invite instructors and students with its code or exact name.');
        html = html.replace('Instructor Account ID', 'Administrator Account ID');
        html = html.replace('For example tch202601', 'For example sch20260101');
        html = html.replace('Must start with tch followed by digits (e.g. tch202601).', 'Must start with sch followed by digits (e.g. sch20260101).');
        html = html.replace('<div class="field"><label for="auth-email">Email Address</label>', '<div class="field"><label for="auth-school-name">School / Organization Name</label><input id="auth-school-name" name="schoolName" maxlength="100" placeholder="For example, Peking University" required></div><div class="field"><label for="auth-school-code">School Code (optional)</label><input id="auth-school-code" name="schoolCode" maxlength="16" placeholder="For example, 1008611"><div class="field-hint">Leave blank to generate a code automatically.</div></div><div class="field"><label for="auth-email">Email Address</label>');
        html = html.replace('Create Instructor Account →', 'Create School Administrator Account →');
        html = html.replace('Already have an account?', 'Already have an administrator account?');
      }
    }
    if (state.authMode === 'login') {
      html = html.replace('</form><p class="auth-bottom">', '</form><p class="auth-bottom"><button type="button" data-admin-action="forgot">Forgot password?</button></p><p class="auth-bottom">');
    }
    return html.replace('name@university.edu', 'you@example.com');
  };

  function startAdminLoad() {
    if (adminData || adminLoading || adminError) return;
    adminLoading = true;
    api('/api/admin/overview').then(data => {
      adminData = data;
      adminError = '';
    }).catch(error => {
      adminError = error.message;
    }).finally(() => {
      adminLoading = false;
      if (state.user?.role === 'admin') render();
    });
  }

  function instructorTable() {
    const teachers = adminData?.teachers || [];
    const rows = teachers.map(t => '<tr><td><strong>' + esc(t.name) + '</strong><br><span class="muted">' + esc(t.email) + '</span></td><td>' + esc(t.school?.name || 'Unassigned') + '</td>' +
      '<td>' + (t.active ? '<span class="pill green">Active</span>' : '<span class="pill gray">Inactive</span>') + '</td><td>' + n(t.courseCount) + '</td><td>' +
      (t.active ? '<div class="row wrap"><button type="button" class="btn btn-soft btn-sm" data-admin-action="password" data-id="' + esc(t.id) + '" data-role="teacher">Reset Password</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-admin-action="remove-teacher" data-id="' + esc(t.id) + '">Deactivate</button></div>' : '—') + '</td></tr>').join('');
    return '<section class="panel panel-pad" style="margin-bottom:20px"><h2>Add an Instructor</h2><p class="small muted">Create a separate login for each instructor.</p>' +
      '<form id="admin-add-teacher"><div class="form-grid"><div class="field"><label for="admin-teacher-name">Name</label><input id="admin-teacher-name" name="name" required maxlength="60"></div>' +
      '<div class="field"><label for="admin-teacher-email">Email</label><input id="admin-teacher-email" name="email" type="email" placeholder="teacher@example.com" required></div>' +
      '<div class="field"><label for="admin-teacher-password">Temporary Password</label><input id="admin-teacher-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div></div>' +
      '<button type="submit" class="btn btn-primary">Create Instructor Account</button></form></section>' +
      '<section class="panel"><div class="panel-pad"><h2>Instructor Accounts</h2><p class="small muted">Deactivate an account to prevent sign-in while retaining its courses and records.</p></div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>Instructor</th><th>School</th><th>Status</th><th>Courses</th><th>Actions</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5">No instructor accounts yet.</td></tr>') + '</tbody></table></div></section>';
  }

  function studentTable() {
    const students = adminData?.students || [];
    const courses = adminData?.courses || [];
    if (!students.length) return em('No students yet', 'Students will appear here after registering.');
    return students.map(s => {
      const enrolled = new Set((s.enrollments || []).map(e => e.courseId));
      const list = (s.enrollments || []).map(e => '<div class="student-detail-row"><span><strong>' + esc(e.courseTitle) + '</strong> · ' + esc(e.teacherName || 'Instructor') + '</span>' +
        '<button class="btn btn-danger btn-sm" type="button" data-admin-action="remove-enrollment" data-student-id="' + esc(s.id) + '" data-course-id="' + esc(e.courseId) + '">Remove</button></div>').join('');
      const available = courses.filter(c => !enrolled.has(c.id));
      const options = available.map(c => '<option value="' + esc(c.id) + '">' + esc(c.title) + ' · ' + esc(c.teacherName || 'Instructor') + '</option>').join('');
      const addForm = available.length ? '<form class="admin-enrollment-form" data-student-id="' + esc(s.id) + '"><div class="row wrap"><select name="courseId" aria-label="Course to add" required>' + options +
        '</select><button class="btn btn-soft btn-sm" type="submit">Add to Course</button></div></form>' : '<p class="small muted">Enrolled in every available course.</p>';
      return '<section class="panel panel-pad" style="margin-bottom:16px"><div class="row-between"><div><h2 style="margin:0 0 5px">' + esc(s.name) + '</h2><p class="small muted" style="margin:0">' +
        esc(s.email) + ' · Student ID ' + esc(s.studentId || 'N/A') + ' · ' + esc(s.school?.name || 'Unassigned') + '</p></div><button class="btn btn-soft btn-sm" type="button" data-admin-action="password" data-id="' + esc(s.id) +
        '" data-role="student">Reset Password</button></div><div class="student-detail">' + (list || '<p class="small muted">No enrolled courses.</p>') + '</div>' +
        '<div style="margin-top:16px"><strong class="small">Adjust Course Enrollment</strong>' + addForm + '</div></section>';
    }).join('');
  }

  function passwordDialog() {
    if (!adminDialog) return '';
    return '<div class="modal-backdrop" data-admin-action="close-dialog"><div class="modal"><div class="modal-head"><h2>Reset ' + esc(adminDialog.role) +
      ' Password</h2><button class="icon-btn" type="button" data-admin-action="close-dialog" aria-label="Close">✕</button></div><form id="admin-password-form" data-id="' +
      esc(adminDialog.id) + '"><div class="modal-body"><p class="small muted">Set a new password for ' + esc(adminDialog.name) + '.</p><div class="field"><label for="admin-new-password">New Password</label>' +
      '<input id="admin-new-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div><div class="field"><label for="admin-confirm-password">Confirm Password</label>' +
      '<input id="admin-confirm-password" name="confirm" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></div></div><div class="modal-actions">' +
      '<button class="btn btn-light" type="button" data-admin-action="close-dialog">Cancel</button><button class="btn btn-primary" type="submit">Save Password</button></div></form></div></div>';
  }

  function adminShell() {
    const s = adminData?.stats || {};
    const organization = adminData?.organization;
    const scopeLabel = organization ? 'ORGANIZATION ADMINISTRATION' : 'SITE ADMINISTRATION';
    const organizationPanel = organization
      ? '<section class="panel panel-pad" style="margin-bottom:20px"><div class="row-between wrap"><div><div class="eyebrow">SCHOOL ORGANIZATION</div><h2 style="margin:5px 0">' + esc(organization.name) + '</h2><p class="small muted" style="margin:0">Students and instructors can join with the exact school name or code.</p></div><div><div class="tiny muted">SCHOOL CODE</div><strong style="font-size:20px">' + esc(organization.code) + '</strong></div></div></section>'
      : '';
    const body = adminError
      ? '<section class="panel panel-pad"><p class="form-error">' + esc(adminError) + '</p><button class="btn btn-soft" data-admin-action="reload">Retry</button></section>'
      : !adminData ? '<section class="panel panel-pad">Loading administrator records…</section>'
      : '<div class="page-head"><div><div class="eyebrow">' + scopeLabel + '</div><h1>' + (adminTab === 'teachers' ? 'Instructor Accounts' : 'Student Accounts') +
        '</h1><p>Manage user access and student course enrollment.</p></div></div>' + organizationPanel + '<div class="stats-grid" style="margin-bottom:24px">' +
        stat('Instructors', n(s.teachers), 'Registered instructor accounts', '♧') + stat('Students', n(s.students), 'Registered student accounts', '▣') +
        stat('Courses', n(s.courses), 'Courses across instructors', '▤') + '</div>' + (adminTab === 'teachers' ? instructorTable() : studentTable());
    return '<div class="mobile-overlay ' + (state.mobileOpen ? 'show' : '') + '" data-admin-action="close-menu"></div><div class="app-shell"><aside class="sidebar ' +
      (state.mobileOpen ? 'open' : '') + '">' + brand() + '<div class="sidebar-label">' + scopeLabel + '</div><nav class="nav-list" aria-label="Administrator Menu">' +
      '<button type="button" class="nav-btn ' + (adminTab === 'teachers' ? 'active' : '') + '" data-admin-action="tab" data-tab="teachers"><span class="ico">♧</span>Instructors</button>' +
      '<button type="button" class="nav-btn ' + (adminTab === 'students' ? 'active' : '') + '" data-admin-action="tab" data-tab="students"><span class="ico">▣</span>Students</button></nav>' +
      '<div class="sidebar-bottom"><div class="side-user"><span class="avatar sm">' + initials(state.user?.name) + '</span><span class="side-user-text"><strong>' + esc(state.user?.name) +
      '</strong><small>' + (organization ? 'School Administrator' : 'Site Administrator') + '</small></span><button class="icon-btn" type="button" data-admin-action="logout" aria-label="Sign Out" title="Sign Out">↪</button></div></div></aside>' +
      '<div class="main-area"><header class="topbar"><div class="row"><button class="mobile-menu" type="button" data-admin-action="toggle-menu" aria-label="Open Menu">☰</button>' +
      '<div class="breadcrumbs">Zhixing Learning / <b>Administration</b></div></div><span class="role-chip">' + (organization ? 'School Administrator' : 'Site Administrator') + '</span></header><main class="content">' + body +
      '<footer class="site-footer">Zhixing Learning · Site Administration</footer></main></div></div>' + passwordDialog();
  }

  render = function() {
    if (state.authMode === 'reset' && resetToken) {
      app.innerHTML = authRecoveryPage();
      return;
    }
    if (state.user?.role === 'admin') {
      startAdminLoad();
      app.innerHTML = adminShell();
      return;
    }
    if (!state.user && state.authMode === 'forgot') {
      app.innerHTML = authRecoveryPage();
      return;
    }
    if (!state.user) adminData = null;
    originalRender();
  };

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-action]');
    if (!button) return;
    const action = button.dataset.adminAction;
    if (action === 'close-dialog' && button.classList.contains('modal-backdrop') && event.target !== button) return;
    event.preventDefault();
    if (action === 'forgot') {
      state.authMode = 'forgot'; state.authError = ''; resetNotice = ''; render(); return;
    }
    if (action === 'back-to-login') {
      resetToken = ''; resetNotice = ''; state.authMode = 'login'; state.authError = ''; render(); return;
    }
    if (action === 'tab') { adminTab = button.dataset.tab; state.mobileOpen = false; render(); return; }
    if (action === 'toggle-menu') { state.mobileOpen = !state.mobileOpen; render(); return; }
    if (action === 'close-menu') { state.mobileOpen = false; render(); return; }
    if (action === 'close-dialog') { adminDialog = null; render(); return; }
    if (action === 'reload') { adminError = ''; adminData = null; render(); return; }
    if (action === 'logout') {
      run(async () => { await api('/api/auth/logout', {method:'POST'}); state.user = null; state.authRole = 'student'; state.authMode = 'login'; adminData = null; adminDialog = null; render(); showToast('You have signed out'); });
      return;
    }
    if (action === 'password') {
      const source = (button.dataset.role === 'teacher' ? adminData?.teachers : adminData?.students) || [];
      const person = source.find(item => item.id === button.dataset.id);
      if (person) { adminDialog = {id:person.id,name:person.name,role:button.dataset.role}; render(); }
      return;
    }
    if (action === 'remove-teacher') {
      const teacher = (adminData?.teachers || []).find(t => t.id === button.dataset.id);
      if (!teacher || !confirm('Deactivate ' + teacher.name + '? They will no longer be able to sign in. Their courses and student records will be kept.')) return;
      run(async () => { await api('/api/admin/teachers/' + encodeURIComponent(teacher.id), {method:'DELETE'}); adminData = await api('/api/admin/overview'); render(); showToast('Instructor account deactivated'); }, 'Could not deactivate instructor: ');
      return;
    }
    if (action === 'remove-enrollment') {
      const student = (adminData?.students || []).find(s => s.id === button.dataset.studentId);
      const enrollment = student?.enrollments?.find(e => e.courseId === button.dataset.courseId);
      if (!student || !enrollment || !confirm('Remove ' + student.name + ' from ' + enrollment.courseTitle + '?')) return;
      run(async () => { await api('/api/admin/students/' + encodeURIComponent(student.id) + '/enrollments/' + encodeURIComponent(enrollment.courseId), {method:'DELETE'}); adminData = await api('/api/admin/overview'); render(); showToast('Student removed from course'); }, 'Could not update enrollment: ');
    }
  });

  // Handle administrator sign-in and school creation before the shared auth form listener.
  document.addEventListener('submit', event => {
    if (event.target.id !== 'auth-form' || state.authMode !== 'register' || state.authRole !== 'admin') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const values = Object.fromEntries(new FormData(event.target));
    run(async () => {
      try {
        const registering = state.authMode === 'register';
        const result = registering
          ? await api('/api/auth/register-admin', {method:'POST',body:JSON.stringify(values)})
          : await api('/api/auth/login', {method:'POST',body:JSON.stringify({email:values.email,password:values.password})});
        if (result.user?.role !== 'admin') {
          await api('/api/auth/logout', {method:'POST'});
          throw new Error('This account is not a site administrator.');
        }
        state.user = result.user; state.authError = ''; adminData = null; adminError = ''; state.page = 'admin'; render();
        showToast((registering ? 'Organization created. Welcome, ' : 'Welcome back, ') + state.user.name + '!');
      } catch (error) { state.authError = error.message; render(); }
    });
  }, true);

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!['admin-reset-request','admin-reset-confirm','admin-add-teacher','admin-password-form'].includes(form.id) && !form.classList.contains('admin-enrollment-form')) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'admin-reset-request') {
      run(async () => {
        try {
          const result = await api('/api/auth/forgot-password', {method:'POST',body:JSON.stringify({email:values.email})});
          resetNotice = result.message || 'If an account uses this email address, a reset link will be sent.';
        } catch (error) { resetNotice = error.message; }
        render();
      });
      return;
    }
    if (form.id === 'admin-reset-confirm') {
      if (values.password !== values.confirm) { showToast('Passwords do not match', true); return; }
      run(async () => {
        await api('/api/auth/reset-password', {method:'POST',body:JSON.stringify({token:resetToken,password:values.password})});
        resetToken = ''; resetNotice = ''; state.user = null; state.authMode = 'login'; state.authRole = 'student'; render();
        showToast('Password updated. You can sign in now.');
      }, 'Could not reset password: ');
      return;
    }
    if (state.user?.role !== 'admin') return;
    if (form.id === 'admin-add-teacher') {
      run(async () => {
        await api('/api/admin/teachers', {method:'POST',body:JSON.stringify({name:values.name,email:values.email,password:values.password})});
        adminData = await api('/api/admin/overview'); render(); showToast('Instructor account created');
      }, 'Could not create instructor: ');
      return;
    }
    if (form.id === 'admin-password-form') {
      if (values.password !== values.confirm) { showToast('Passwords do not match', true); return; }
      run(async () => {
        await api('/api/admin/users/' + encodeURIComponent(form.dataset.id) + '/password', {method:'PATCH',body:JSON.stringify({password:values.password})});
        adminDialog = null; render(); showToast('Password updated');
      }, 'Could not update password: ');
      return;
    }
    if (form.classList.contains('admin-enrollment-form')) {
      const student = (adminData?.students || []).find(s => s.id === form.dataset.studentId);
      const course = (adminData?.courses || []).find(c => c.id === values.courseId);
      if (!student || !course || !confirm('Add ' + student.name + ' to ' + course.title + '?')) return;
      run(async () => {
        await api('/api/admin/students/' + encodeURIComponent(student.id) + '/enrollments/' + encodeURIComponent(course.id), {method:'POST'});
        adminData = await api('/api/admin/overview'); render(); showToast('Student added to course');
      }, 'Could not update enrollment: ');
    }
  });
})();
