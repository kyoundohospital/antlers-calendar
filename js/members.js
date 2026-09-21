// メンバー画面: 自分の表示名・バッジ文字の変更、管理者による許可リスト（メールアドレス）の管理、ログアウト

import { saveProfile, saveMemberEmails, defaultLabel } from './store.js';

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function closeModal(overlay) {
  overlay.classList.add('hidden');
  overlay.innerHTML = '';
}

function field(labelText, inputEl) {
  const wrap = el('div', 'field');
  wrap.appendChild(el('label', null, labelText));
  wrap.appendChild(inputEl);
  return wrap;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function openMembersManager(overlay, ctx) {
  const { user, isAdmin, members, profiles, backendMode, onSignOut, onSaved, onProfileSaved } = ctx;
  overlay.innerHTML = '';
  overlay.classList.remove('hidden');

  const box = el('div', 'modal-box');
  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.addEventListener('click', () => closeModal(overlay));
  box.appendChild(closeBtn);
  box.appendChild(el('h2', null, 'メンバー'));

  // --- 自分の表示 ---
  const me = profiles[user.uid] || { name: user.name, label: defaultLabel(user.name) };
  box.appendChild(el('h3', 'plans-heading', '自分の表示'));
  if (user.email) box.appendChild(el('p', 'members-note', `ログイン中: ${user.email}`));
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = me.name || '';
  nameInput.maxLength = 20;
  box.appendChild(field('表示名', nameInput));
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = me.label || defaultLabel(me.name);
  labelInput.maxLength = 2;
  box.appendChild(field('カレンダーのバッジに出す文字（1〜2文字）', labelInput));
  const saveMeBtn = el('button', 'primary', '表示を保存');
  saveMeBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim() || user.name;
    const label = labelInput.value.trim() || defaultLabel(name);
    try {
      await saveProfile(user.uid, { name, label });
      onProfileSaved({ name, label });
      onSaved('表示名を保存しました');
      closeModal(overlay);
    } catch (e) {
      console.error(e);
      alert('保存に失敗しました');
    }
  });
  const meActions = el('div', 'modal-actions');
  meActions.appendChild(saveMeBtn);
  box.appendChild(meActions);

  // --- 許可リスト ---
  if (backendMode === 'firestore') {
    box.appendChild(el('h3', 'plans-heading', '利用できるメンバー'));
    box.appendChild(
      el(
        'p',
        'members-note',
        isAdmin
          ? 'ここに登録したGoogleアカウントだけがログインして使えます。'
          : 'メンバーの追加・削除は管理者だけができます。'
      )
    );
    let emails = [...(members.emails || [])];
    const nameByEmail = Object.fromEntries(Object.values(profiles).map((p) => [p.email, p.name]));
    const adminEmails = new Set(
      Object.entries(profiles)
        .filter(([uid]) => (members.admins || []).includes(uid))
        .map(([, p]) => p.email)
    );
    const list = el('ul', 'members-list');

    const save = async (next) => {
      try {
        await saveMemberEmails(next);
        emails = next;
        renderList();
        onSaved('メンバーを更新しました');
      } catch (e) {
        console.error(e);
        alert('メンバーの更新に失敗しました');
      }
    };

    function renderList() {
      list.innerHTML = '';
      for (const email of emails) {
        const li = el('li');
        const text = el('span', 'members-list__email', email);
        li.appendChild(text);
        const tags = [nameByEmail[email], adminEmails.has(email) ? '管理者' : null].filter(Boolean);
        if (tags.length) li.appendChild(el('span', 'members-list__tag', tags.join('・')));
        else li.appendChild(el('span', 'members-list__tag', '未ログイン'));
        // 自分自身は外せない（誤って管理者がいなくなるのを防ぐ）
        if (isAdmin && email !== user.email) {
          const removeBtn = el('button', null, '削除');
          removeBtn.addEventListener('click', () => {
            if (confirm(`${email} をメンバーから外しますか？`)) save(emails.filter((e) => e !== email));
          });
          li.appendChild(removeBtn);
        }
        list.appendChild(li);
      }
    }
    renderList();
    box.appendChild(list);

    if (isAdmin) {
      const addRow = el('div', 'members-add');
      const emailInput = document.createElement('input');
      emailInput.type = 'email';
      emailInput.placeholder = '追加するGoogleアカウントのメールアドレス';
      const addBtn = el('button', 'primary', '追加');
      addBtn.addEventListener('click', () => {
        const email = emailInput.value.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(email)) {
          alert('メールアドレスの形式が正しくありません');
          return;
        }
        if (emails.includes(email)) {
          alert('すでに登録されています');
          return;
        }
        emailInput.value = '';
        save([...emails, email]);
      });
      addRow.appendChild(emailInput);
      addRow.appendChild(addBtn);
      box.appendChild(addRow);
    }
  }

  const actions = el('div', 'modal-actions');
  if (backendMode === 'firestore') {
    const signOutBtn = el('button', null, 'ログアウト');
    signOutBtn.addEventListener('click', async () => {
      closeModal(overlay);
      await onSignOut();
    });
    actions.appendChild(signOutBtn);
  }
  const closeBtn2 = el('button', null, '閉じる');
  closeBtn2.addEventListener('click', () => closeModal(overlay));
  actions.appendChild(closeBtn2);
  box.appendChild(actions);

  overlay.appendChild(box);
}
