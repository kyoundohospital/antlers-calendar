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

function makePlaceId() {
  return 'place-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function openPlacesManager(overlay, places, onSave) {
  let working = places.map((p) => ({ ...p }));

  function renderRows(listEl) {
    listEl.innerHTML = '';
    working
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((p, idx, arr) => {
        const row = el('div', 'place-row');

        const swatch = el('span', 'place-swatch');
        swatch.style.background = p.color;
        row.appendChild(swatch);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = p.name;
        nameInput.placeholder = '観戦場所名';
        nameInput.addEventListener('input', () => {
          p.name = nameInput.value;
        });
        row.appendChild(nameInput);

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = p.shortLabel;
        labelInput.maxLength = 3;
        labelInput.style.width = '48px';
        labelInput.placeholder = 'バッヂ';
        labelInput.addEventListener('input', () => {
          p.shortLabel = labelInput.value.slice(0, 3);
          swatch.textContent = '';
        });
        row.appendChild(labelInput);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#888888';
        colorInput.addEventListener('input', () => {
          p.color = colorInput.value;
          swatch.style.background = p.color;
        });
        row.appendChild(colorInput);

        const activeLabel = el('label', null);
        activeLabel.style.fontSize = '11px';
        activeLabel.style.display = 'flex';
        activeLabel.style.alignItems = 'center';
        activeLabel.style.gap = '2px';
        const activeCheckbox = document.createElement('input');
        activeCheckbox.type = 'checkbox';
        activeCheckbox.checked = p.isActive !== false;
        activeCheckbox.addEventListener('change', () => {
          p.isActive = activeCheckbox.checked;
        });
        activeLabel.appendChild(activeCheckbox);
        activeLabel.appendChild(document.createTextNode('使用中'));
        row.appendChild(activeLabel);

        const reorder = el('div', 'reorder-btns');
        const upBtn = el('button', null, '▲');
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => {
          const prev = arr[idx - 1];
          const tmp = prev.sortOrder;
          prev.sortOrder = p.sortOrder;
          p.sortOrder = tmp;
          renderRows(listEl);
        });
        const downBtn = el('button', null, '▼');
        downBtn.disabled = idx === arr.length - 1;
        downBtn.addEventListener('click', () => {
          const next = arr[idx + 1];
          const tmp = next.sortOrder;
          next.sortOrder = p.sortOrder;
          p.sortOrder = tmp;
          renderRows(listEl);
        });
        reorder.appendChild(upBtn);
        reorder.appendChild(downBtn);
        row.appendChild(reorder);

        const delBtn = el('button', null, '削除');
        delBtn.addEventListener('click', () => {
          if (confirm(`「${p.name}」を削除しますか？`)) {
            working = working.filter((x) => x.id !== p.id);
            renderRows(listEl);
          }
        });
        row.appendChild(delBtn);

        listEl.appendChild(row);
      });
  }

  overlay.innerHTML = '';
  overlay.classList.remove('hidden');
  const box = el('div', 'modal-box');
  const closeBtn = el('button', 'modal-close', '×');
  closeBtn.addEventListener('click', () => closeModal(overlay));
  box.appendChild(closeBtn);
  box.appendChild(el('h2', null, '観戦場所管理'));

  const list = el('div', 'place-list');
  box.appendChild(list);
  renderRows(list);

  const addBtn = el('button', null, '＋ 観戦場所を追加');
  addBtn.style.marginTop = '8px';
  addBtn.addEventListener('click', () => {
    working.push({
      id: makePlaceId(),
      name: '新しい観戦場所',
      shortLabel: '新',
      color: '#607d8b',
      sortOrder: working.length,
      isActive: true,
    });
    renderRows(list);
  });
  box.appendChild(addBtn);

  const actions = el('div', 'modal-actions');
  const saveBtn = el('button', 'primary', '保存');
  saveBtn.addEventListener('click', () => {
    const normalized = working
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p, i) => ({ ...p, sortOrder: i }));
    onSave(normalized);
    closeModal(overlay);
  });
  actions.appendChild(saveBtn);
  const cancelBtn = el('button', null, 'キャンセル');
  cancelBtn.addEventListener('click', () => closeModal(overlay));
  actions.appendChild(cancelBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
}
