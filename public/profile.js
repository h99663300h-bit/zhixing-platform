// Personal profile for both student and teacher spaces.
(() => {
  state.profile = null;
  state.avatarVersion = 0;
  let previewUrl = null;
  const originalShell = shell;
  const originalRender = render;
  const originalNavigate = navigate;

  function avatarSrc(profile) {
    if (!profile?.avatarUrl) return '';
    const suffix = state.avatarVersion ? '?v=' + state.avatarVersion : '';
    return esc(profile.avatarUrl + suffix);
  }
  function avatarMarkup(profile, size) {
    const src = avatarSrc(profile);
    return src
      ? '<img class="avatar ' + size + ' profile-avatar-image" src="' + src + '" alt="Profile photo of ' + esc(profile.name || 'user') + '">'
      : '<span class="avatar ' + size + '">' + initials(profile?.name) + '</span>';
  }
  function syncProfile(profile, avatarChanged) {
    state.profile = profile;
    state.user = { ...state.user, ...profile };
    if (avatarChanged) state.avatarVersion = Date.now();
    render();
  }
  function profileView() {
    const p = state.profile || state.user;
    const teacher = p.role === 'teacher';
    const gender = ({ '\u7537': 'Male', '\u5973': 'Female', '\u5176\u4ed6': 'Other', '\u4e0d\u4fbf\u900f\u9732': 'Prefer not to say' })[p.gender] || p.gender || '';
    const studentId = teacher ? 'Not applicable' : p.studentId || 'Not set';
    const genderOptions = [ ['', 'Select an option'], ['Male', 'Male'], ['Female', 'Female'], ['Other', 'Other'], ['Prefer not to say', 'Prefer not to say'] ];
    const organizationPanel = p.school
      ? '<section class="panel panel-pad" style="grid-column:1/-1"><div class="eyebrow">SCHOOL ORGANIZATION</div><h2 style="margin:5px 0">' + esc(p.school.name) + '</h2><p class="small muted" style="margin:0">School code: <strong>' + esc(p.school.code) + '</strong></p></section>'
      : p.pendingSchool
        ? '<section class="panel panel-pad" style="grid-column:1/-1"><div class="eyebrow">PENDING APPROVAL</div><h2 style="margin:5px 0">' + esc(p.pendingSchool.name) + '</h2><p class="small muted" style="margin:0">School code: <strong>' + esc(p.pendingSchool.code) + '</strong> · Waiting for the school administrator to approve your binding request.</p></section>'
        : '<section class="panel panel-pad" style="grid-column:1/-1"><h2>School / Organization</h2><p class="small muted">' + (teacher ? 'Submit a school code or exact school name. Your request will be sent to the school administrator for approval.' : 'Link this account to a school so its administrator can manage your account.') + '</p><form id="profile-school-form"><div class="field"><label for="profile-school">School code or exact school name</label><input id="profile-school" name="school" maxlength="100" placeholder="For example, 1008611 or Peking University" required></div><button type="submit" class="btn btn-primary">' + (teacher ? 'Submit School Binding Request' : 'Join School Organization') + '</button></form></section>';
    return `<div class="page-head"><div><div class="eyebrow">PERSONAL PROFILE</div><h1>Personal Information</h1><p>Manage your profile and photo.</p></div><span class="role-chip">${teacher ? 'Teacher Account' : 'Student Account'}</span></div>
      <div class="profile-layout"><section class="panel panel-pad profile-card"><div class="profile-card-head"><span class="profile-avatar-wrap">${avatarMarkup(p, 'profile-large')}</span><div><h2>${esc(p.name || 'User')}</h2><p class="small muted">${esc(p.email || '')}</p><span class="pill blue">${teacher ? 'Teacher' : 'Student'}</span></div></div>
      <form id="profile-avatar-form"><label for="profile-avatar-file">Change Profile Photo</label><input id="profile-avatar-file" type="file" accept="image/png,image/jpeg,image/webp" required><p class="field-hint">PNG, JPG, or WebP. Maximum size: 3 MB.</p><button type="submit" class="btn btn-soft">Upload Photo</button></form></section>
      <section class="panel panel-pad profile-fields"><h2>Basic Details</h2><p class="small muted">You can edit your name, gender, and year. Your student ID is set at registration and cannot be changed.</p><form id="profile-form"><div class="form-grid"><div class="field"><label for="profile-name">Name</label><input id="profile-name" name="name" value="${esc(p.name)}" maxlength="60" autocomplete="name" required></div><div class="field"><label for="profile-gender">Gender</label><select id="profile-gender" name="gender">${genderOptions.map(option => `<option value="${esc(option[0])}"${gender === option[0] ? ' selected' : ''}>${option[1]}</option>`).join('')}</select></div><div class="field"><label for="profile-student-id">Student ID</label><input id="profile-student-id" value="${esc(studentId)}" readonly aria-readonly="true" title="Student ID cannot be changed"><div class="field-hint">${teacher ? 'Teachers do not have a student ID.' : 'Student ID cannot be changed.'}</div></div><div class="field"><label for="profile-grade">Year of Study</label><input id="profile-grade" name="grade" value="${esc(p.grade || '')}" maxlength="30" placeholder="e.g., Year 2 / Class of 2026"></div><div class="field"><label for="profile-department">Department</label><input id="profile-department" value="${esc(p.department || 'Not set')}" readonly aria-readonly="true"></div><div class="field"><label for="profile-major">Major</label><input id="profile-major" value="${esc(p.major || 'Not set')}" readonly aria-readonly="true"></div></div><div class="profile-actions"><button type="submit" class="btn btn-primary">Save Profile</button></div></form></section></div>${organizationPanel}`;
  }

  shell = function(content) {
    let html = originalShell(content);
    if (!state.user) return html;
    html = html.replace('</nav>', navItem('profile', 'Personal Information', '♙') + '</nav>');
    if (state.page === 'profile') html = html.replace('<b>Learning Space</b>', '<b>Personal Information</b>');
    if (state.user.avatarUrl) {
      const mainStart = html.indexOf('<main class="content">');
      if (mainStart >= 0) html = html.slice(0, mainStart).replace(/<span class="avatar sm">[^<]*<\/span>/g, avatarMarkup(state.user, 'sm')) + html.slice(mainStart);
    }
    return html;
  };
  render = function() {
    if (state.user && state.page === 'profile') {
      app.innerHTML = shell(profileView());
      return;
    }
    originalRender();
  };
  navigate = async function(page) {
    if (page === 'profile') {
      const result = await api('/api/profile');
      state.profile = result.profile;
    }
    await originalNavigate(page);
  };
  document.addEventListener('change', event => {
    if (event.target.id !== 'profile-avatar-file') return;
    const file = event.target.files?.[0];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = file ? URL.createObjectURL(file) : null;
    const wrap = document.querySelector('.profile-avatar-wrap');
    if (wrap && previewUrl) wrap.innerHTML = '<img class="avatar profile-large profile-avatar-image" src="' + esc(previewUrl) + '" alt="New profile photo preview">';
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'profile-school-form') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const school = new FormData(event.target).get('school')?.toString().trim();
      run(async () => {
        const result = await api('/api/profile/organization', { method: 'POST', body: JSON.stringify({ school }) });
        syncProfile(result.profile, false);
        showToast(result.profile?.pendingSchool ? 'School binding request submitted for administrator approval' : 'School organization linked');
      }, 'Could not join school: ');
      return;
    }
    if (event.target.id === 'profile-form') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const form = event.target;
      const data = Object.fromEntries(new FormData(form));
      run(async () => {
        const result = await api('/api/profile', { method: 'PATCH', body: JSON.stringify({ name: data.name, gender: data.gender, grade: data.grade }) });
        syncProfile(result.profile, false);
        showToast('Profile saved');
      }, 'Could not save profile: ');
    }
    if (event.target.id === 'profile-avatar-form') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const file = event.target.querySelector('#profile-avatar-file')?.files?.[0];
      if (!file) { showToast('Select a profile photo first', true); return; }
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) { showToast('Only PNG, JPG, or WebP images are supported', true); return; }
      if (file.size > 3 * 1024 * 1024) { showToast('Profile photo must not exceed 3 MB', true); return; }
      run(async () => {
        const response = await fetch('/api/profile/avatar', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Profile photo upload failed');
        if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
        syncProfile(result.profile, true);
        showToast('Profile photo updated');
      }, 'Upload failed: ');
    }
  }, true);
})();
