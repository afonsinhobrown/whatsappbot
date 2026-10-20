export const adminHtml = `<!DOCTYPE html>
<html lang="pt-mz">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TECNOINCUBADORA — Painel Admin</title>
<style>
  :root { --navy:#0a1f44; --gold:#c9a227; --bg:#f4f6f9; --border:#dde2ea; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; background:var(--bg); color:#1a1a1a; }
  header { background:var(--navy); color:#fff; padding:14px 20px; display:flex; align-items:center; justify-content:space-between; }
  header h1 { font-size:16px; margin:0; font-weight:600; }
  header .gold { color:var(--gold); }
  #logout-btn { background:transparent; border:1px solid var(--gold); color:var(--gold); padding:6px 12px; border-radius:4px; cursor:pointer; font-size:13px; }
  #login-screen { display:flex; height:100vh; align-items:center; justify-content:center; }
  #login-box { background:#fff; padding:32px; border-radius:8px; box-shadow:0 2px 12px rgba(0,0,0,0.08); width:300px; text-align:center; }
  #login-box h2 { color:var(--navy); margin-top:0; font-size:18px; }
  #login-box input { width:100%; padding:10px; margin:10px 0; border:1px solid var(--border); border-radius:4px; font-size:14px; }
  #login-box button { width:100%; padding:10px; background:var(--navy); color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600; }
  #app { display:none; }
  .layout { display:flex; min-height:calc(100vh - 52px); }
  nav { width:220px; background:#fff; border-right:1px solid var(--border); padding:12px 0; }
  nav button { display:block; width:100%; text-align:left; padding:10px 18px; background:none; border:none; cursor:pointer; font-size:14px; color:#333; }
  nav button.active { background:var(--bg); border-left:3px solid var(--gold); color:var(--navy); font-weight:600; }
  main { flex:1; padding:20px; overflow:auto; }
  .toolbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; gap:10px; }
  .toolbar h2 { color:var(--navy); font-size:18px; margin:0; }
  .toolbar input { padding:8px 10px; border:1px solid var(--border); border-radius:4px; font-size:13px; width:200px; }
  .btn { background:var(--navy); color:#fff; border:none; padding:8px 14px; border-radius:4px; cursor:pointer; font-size:13px; }
  .btn.gold { background:var(--gold); color:#1a1a1a; font-weight:600; }
  table { width:100%; border-collapse:collapse; background:#fff; font-size:13px; }
  th, td { border:1px solid var(--border); padding:8px 10px; text-align:left; max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  th { background:var(--navy); color:#fff; font-weight:600; }
  tr:nth-child(even) { background:#fafbfc; }
  td.actions button { margin-right:4px; padding:4px 8px; font-size:12px; cursor:pointer; border:1px solid var(--border); background:#fff; border-radius:3px; }
  td.actions button.del { color:#b00020; }
  #modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.4); align-items:center; justify-content:center; z-index:10; }
  #modal { background:#fff; padding:24px; border-radius:8px; width:480px; max-height:85vh; overflow:auto; }
  #modal h3 { color:var(--navy); margin-top:0; }
  #modal label { display:block; font-size:12px; color:#555; margin-top:10px; }
  #modal input, #modal textarea { width:100%; padding:8px; border:1px solid var(--border); border-radius:4px; font-size:13px; margin-top:3px; }
  #modal .modal-actions { margin-top:18px; display:flex; gap:8px; justify-content:flex-end; }
  .error { color:#b00020; font-size:13px; margin-top:8px; min-height:16px; }
  .empty { padding:30px; text-align:center; color:#888; }
  .hint { color:#888; font-size:12px; }
  /* Licenças Cash */
  #cash-view h2 { color:var(--navy); font-size:18px; margin:0 0 4px; }
  .cash-card { background:#fff; border:1px solid var(--border); border-radius:8px; padding:16px; margin-top:14px; max-width:720px; }
  .cash-card label { display:block; font-size:12px; color:#555; margin-top:12px; }
  .cash-card input, .cash-card select { width:100%; padding:8px; border:1px solid var(--border); border-radius:4px; font-size:13px; margin-top:3px; }
  .cash-row { display:flex; gap:8px; flex-wrap:wrap; }
  .cash-row input, .cash-row select { flex:1; min-width:180px; }
  .cash-opt { display:block; background:#fafbfc; border:1px solid var(--border); border-radius:4px; padding:8px 10px; margin-top:6px; font-size:13px; cursor:pointer; }
  .cash-opt input { width:auto; margin:0 6px 0 0; }
  .cash-opt small { color:#666; }
  #cash-recibo { margin-top:16px; }
  .recibo { background:#fff; border:1px solid var(--border); border-radius:8px; padding:24px; max-width:720px; }
  .recibo h3 { margin:0; color:var(--navy); font-size:17px; }
  .recibo .brand { color:var(--gold); font-weight:700; font-size:12px; letter-spacing:1px; }
  .recibo table { margin-top:14px; }
  .recibo td { border:none; border-bottom:1px solid var(--border); }
  .recibo td:first-child { color:#666; width:45%; }
  .recibo .nota { margin-top:16px; font-size:11px; color:#777; }
  .recibo-actions { margin-top:16px; }
  #cash-historico { margin-top:12px; }
  @media print {
    body * { visibility:hidden; }
    #cash-recibo, #cash-recibo * { visibility:visible; }
    #cash-recibo { position:absolute; left:0; top:0; width:100%; }
    #cash-recibo .recibo-actions { display:none; }
  }
</style>
</head>
<body>
<div id="login-screen">
  <div id="login-box">
    <h2>TECNOINCUBADORA<br/><span style="color:#c9a227;font-size:13px;">Painel Admin — Bots</span></h2>
    <input id="password" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')login()" />
    <button onclick="login()">Entrar</button>
    <div id="login-error" class="error"></div>
  </div>
</div>

<div id="app">
  <header>
    <h1>TECNOINCUBADORA <span class="gold">| Painel Admin — Bots</span></h1>
    <button id="logout-btn" onclick="logout()">Sair</button>
  </header>
  <div class="layout">
    <nav id="nav"></nav>
    <main>
      <div id="table-view">
        <div class="toolbar">
          <h2 id="table-title"></h2>
          <input id="filter" placeholder="Filtrar..." oninput="renderTable()" />
          <button class="btn gold" onclick="openModal()">+ Novo registo</button>
        </div>
        <div id="table-container"></div>
      </div>

      <div id="cash-view" style="display:none">
        <h2>Licenças Cash</h2>
        <div class="hint">Actualiza a data-fim da licença directamente no sistema do cliente e emite um talão de conferência. Para pagamentos que não passaram pela PaySuite.</div>

        <div class="cash-card">
          <label for="cash-sistema">Sistema</label>
          <select id="cash-sistema">
            <option value="CAFEPOINT">Cafe Point</option>
            <option value="XONGUILE">Salaoapp / Xonguile</option>
            <option value="GESTORFARMA">GestorFarma</option>
            <option value="ARMAZEM">Armazém</option>
          </select>

          <label for="cash-nome">Nome do tenant / cliente</label>
          <div class="cash-row">
            <input id="cash-nome" placeholder="Ex.: Angi Arte" onkeydown="if(event.key==='Enter')cashProcurar()" />
            <button class="btn" onclick="cashProcurar()">Procurar</button>
          </div>
          <div id="cash-resultados"></div>

          <label for="cash-data">Nova data-fim</label>
          <div class="cash-row">
            <input type="date" id="cash-data" />
            <button class="btn" onclick="cashMais30()">+30 dias</button>
          </div>

          <label for="cash-valor">Valor pago (MZN, opcional)</label>
          <input type="number" id="cash-valor" min="0" step="0.01" placeholder="0,00" />

          <label for="cash-obs">Observação (opcional)</label>
          <input id="cash-obs" placeholder="Ex.: pagamento em dinheiro na loja" />

          <div class="error" id="cash-erro"></div>
          <div style="margin-top:14px">
            <button class="btn gold" onclick="cashAplicar()">Aplicar e gerar talão</button>
          </div>
        </div>

        <div id="cash-recibo"></div>

        <h3 style="color:var(--navy);font-size:15px;margin-top:22px">Talões emitidos</h3>
        <div id="cash-historico"></div>
      </div>
    </main>
  </div>
</div>

<div id="modal-overlay">
  <div id="modal">
    <h3 id="modal-title">Novo registo</h3>
    <div id="modal-fields"></div>
    <div class="error" id="modal-error"></div>
    <div class="modal-actions">
      <button onclick="closeModal()">Cancelar</button>
      <button class="btn" onclick="saveRow()">Guardar</button>
    </div>
  </div>
</div>

<script>
var API = '/admin/api';
var state = { tables: {}, current: null, columns: [], rows: [], editingId: null };

function api(path, opts) {
  opts = opts || {};
  return fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body
  }).then(function (res) {
    if (res.status === 401) { showLogin(); throw new Error('sessao expirada'); }
    return res.json().catch(function () { return {}; }).then(function (data) {
      if (!res.ok) throw new Error(data.error || 'erro');
      return data;
    });
  });
}

function showLogin() { document.getElementById('login-screen').style.display = 'flex'; document.getElementById('app').style.display = 'none'; }
function showApp() { document.getElementById('login-screen').style.display = 'none'; document.getElementById('app').style.display = 'block'; }

function login() {
  var password = document.getElementById('password').value;
  var errEl = document.getElementById('login-error');
  errEl.textContent = '';
  api('/login', { method: 'POST', body: JSON.stringify({ password: password }) })
    .then(function () { showApp(); loadTables(); })
    .catch(function () { errEl.textContent = 'Password incorrecta'; });
}

function logout() { fetch(API + '/logout', { method: 'POST' }).then(showLogin); }

function loadTables() {
  api('/tables').then(function (data) {
    state.tables = data.tables;
    var nav = document.getElementById('nav');
    nav.innerHTML = '';

    var cashBtn = document.createElement('button');
    cashBtn.textContent = 'Licenças Cash';
    cashBtn.onclick = function () { selectCash(cashBtn); };
    nav.appendChild(cashBtn);

    Object.keys(state.tables).forEach(function (name) {
      var btn = document.createElement('button');
      btn.textContent = name;
      btn.onclick = function () { selectTable(name, btn); };
      nav.appendChild(btn);
    });
    var first = Object.keys(state.tables)[0];
    if (first) selectTable(first, nav.querySelectorAll('button')[1]);
  });
}

function selectTable(name, btnEl) {
  state.current = name;
  state.columns = state.tables[name];
  document.querySelectorAll('#nav button').forEach(function (b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');
  document.getElementById('cash-view').style.display = 'none';
  document.getElementById('table-view').style.display = 'block';
  document.getElementById('table-title').textContent = name;
  document.getElementById('filter').value = '';
  refreshRows();
}

function selectCash(btnEl) {
  document.querySelectorAll('#nav button').forEach(function (b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');
  document.getElementById('table-view').style.display = 'none';
  document.getElementById('cash-view').style.display = 'block';
  document.getElementById('cash-erro').textContent = '';
  loadCashHistorico();
}

function refreshRows() {
  api('/rows?table=' + encodeURIComponent(state.current)).then(function (data) {
    state.rows = data.rows;
    renderTable();
  });
}

function escapeHtml(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderTable() {
  var container = document.getElementById('table-container');
  var filter = document.getElementById('filter').value.toLowerCase();
  var rows = state.rows;
  if (filter) {
    rows = rows.filter(function (r) { return JSON.stringify(r).toLowerCase().indexOf(filter) !== -1; });
  }
  if (rows.length === 0) { container.innerHTML = '<div class="empty">Sem registos</div>'; return; }
  var cols = state.columns.map(function (c) { return c.column; });
  var html = '<table><thead><tr>';
  cols.forEach(function (c) { html += '<th>' + escapeHtml(c) + '</th>'; });
  html += '<th>Accoes</th></tr></thead><tbody>';
  rows.forEach(function (row) {
    html += '<tr>';
    cols.forEach(function (c) {
      var v = row[c];
      if (v === null || v === undefined) v = '';
      if (typeof v === 'object') v = JSON.stringify(v);
      html += '<td title="' + escapeHtml(v) + '">' + escapeHtml(v) + '</td>';
    });
    var json = escapeHtml(JSON.stringify(row));
    html += '<td class="actions">' +
      '<button onclick="editRow(this)" data-row="' + json + '">Editar</button>' +
      '<button class="del" onclick="deleteRow(' + row.id + ')">Apagar</button>' +
      '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function openModal(row) {
  state.editingId = null;
  var fieldsEl = document.getElementById('modal-fields');
  fieldsEl.innerHTML = '';
  document.getElementById('modal-error').textContent = '';
  var data = row || {};
  if (row) state.editingId = row.id;
  document.getElementById('modal-title').textContent = row ? 'Editar registo #' + row.id : 'Novo registo';
  state.columns.forEach(function (col) {
    if (col.column === 'id') return;
    var label = document.createElement('label');
    label.textContent = col.column + (col.nullable ? '' : ' *');
    var input = document.createElement('textarea');
    input.rows = 1;
    input.dataset.col = col.column;
    var v = data[col.column];
    if (v !== undefined && v !== null) input.value = typeof v === 'object' ? JSON.stringify(v) : v;
    fieldsEl.appendChild(label);
    fieldsEl.appendChild(input);
  });
  document.getElementById('modal-overlay').style.display = 'flex';
}

function editRow(btn) { openModal(JSON.parse(btn.getAttribute('data-row'))); }
function closeModal() { document.getElementById('modal-overlay').style.display = 'none'; }

function saveRow() {
  var inputs = document.querySelectorAll('#modal-fields textarea');
  var body = {};
  inputs.forEach(function (inp) { var val = inp.value; body[inp.dataset.col] = val === '' ? null : val; });
  var errEl = document.getElementById('modal-error');
  var opts;
  if (state.editingId) {
    body.id = state.editingId;
    opts = { method: 'PUT', body: JSON.stringify(body) };
  } else {
    opts = { method: 'POST', body: JSON.stringify(body) };
  }
  api('/rows?table=' + encodeURIComponent(state.current), opts)
    .then(function () { closeModal(); refreshRows(); })
    .catch(function (e) { errEl.textContent = e.message; });
}

function deleteRow(id) {
  if (!confirm('Apagar registo #' + id + '?')) return;
  api('/rows?table=' + encodeURIComponent(state.current), { method: 'DELETE', body: JSON.stringify({ id: id }) })
    .then(refreshRows);
}

/* --- Licenças Cash --- */
var cashContas = [];
var cashRecibos = [];
var SISTEMAS_CASH = {
  CAFEPOINT: 'Cafe Point',
  XONGUILE: 'Salaoapp / Xonguile',
  GESTORFARMA: 'GestorFarma',
  ARMAZEM: 'Armazém'
};

function soData(v) { return v ? String(v).slice(0, 10) : '—'; }

function dataHora(v) {
  if (!v) return '—';
  var d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-MZ');
}

function moedaCash(v) {
  var n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MZN';
}

function isoLocal(d) {
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

function cashProcurar() {
  var sistema = document.getElementById('cash-sistema').value;
  var nome = document.getElementById('cash-nome').value.trim();
  var err = document.getElementById('cash-erro');
  var box = document.getElementById('cash-resultados');
  err.textContent = '';
  document.getElementById('cash-recibo').innerHTML = '';

  if (nome.length < 2) {
    err.textContent = 'Escreva pelo menos 2 caracteres do nome do tenant.';
    return;
  }

  box.innerHTML = '<div class="hint">A procurar...</div>';
  api('/licenca-cash/contas?sistema=' + encodeURIComponent(sistema) + '&nome=' + encodeURIComponent(nome))
    .then(function (data) {
      cashContas = data.contas || [];
      if (!cashContas.length) {
        box.innerHTML = '<div class="hint">Nenhuma conta encontrada com esse nome neste sistema.</div>';
        return;
      }
      var html = '';
      cashContas.forEach(function (c, i) {
        html += '<label class="cash-opt">' +
          '<input type="radio" name="cash-conta" value="' + escapeHtml(String(c.id)) + '"' + (i === 0 ? ' checked' : '') + '> ' +
          '<strong>' + escapeHtml(c.nome || 'sem nome') + '</strong> ' +
          '<small>' + escapeHtml(c.email || 'sem email') + ' · actual: ' + soData(c.data_fim) + '</small>' +
          '</label>';
      });
      box.innerHTML = html;
    })
    .catch(function (e) {
      box.innerHTML = '';
      err.textContent = e.message;
    });
}

function cashMais30() {
  var input = document.getElementById('cash-data');
  var base = input.value ? new Date(input.value + 'T00:00:00') : new Date();
  base.setDate(base.getDate() + 30);
  input.value = isoLocal(base);
}

function cashAplicar() {
  var err = document.getElementById('cash-erro');
  err.textContent = '';

  var sel = document.querySelector('input[name="cash-conta"]:checked');
  if (!sel) {
    err.textContent = 'Procure e selecione a conta a actualizar.';
    return;
  }

  var conta = null;
  cashContas.forEach(function (c) { if (String(c.id) === sel.value) conta = c; });
  if (!conta) {
    err.textContent = 'Conta inválida. Procure outra vez.';
    return;
  }

  var dataFim = document.getElementById('cash-data').value;
  if (!dataFim) {
    err.textContent = 'Escolha a nova data-fim.';
    return;
  }

  if (!confirm('Actualizar a licença de "' + conta.nome + '" para ' + dataFim + '?')) return;

  api('/licenca-cash', {
    method: 'POST',
    body: JSON.stringify({
      sistema: document.getElementById('cash-sistema').value,
      contaId: conta.id,
      nome: conta.nome,
      email: conta.email,
      dataFim: dataFim,
      valor: document.getElementById('cash-valor').value,
      observacao: document.getElementById('cash-obs').value
    })
  }).then(function (data) {
    document.getElementById('cash-nome').value = conta.nome;
    cashProcurar();
    renderRecibo(data.recibo);
    loadCashHistorico();
  }).catch(function (e) {
    err.textContent = e.message;
  });
}

function renderRecibo(r) {
  var sistema = SISTEMAS_CASH[r.sistema] || r.sistema;
  var html = '<div class="recibo" id="recibo-print">' +
    '<div class="brand">TECNOINCUBADORA</div>' +
    '<h3>Talão de Conferência — Licença paga em cash</h3>' +
    '<table>' +
    '<tr><td>Referência</td><td>' + escapeHtml(r.referencia) + '</td></tr>' +
    '<tr><td>Sistema</td><td>' + escapeHtml(sistema) + '</td></tr>' +
    '<tr><td>Cliente / tenant</td><td>' + escapeHtml(r.conta_nome) + '</td></tr>' +
    (r.conta_email ? '<tr><td>Email</td><td>' + escapeHtml(r.conta_email) + '</td></tr>' : '') +
    '<tr><td>Data-fim anterior</td><td>' + soData(r.data_fim_anterior) + '</td></tr>' +
    '<tr><td>Nova data-fim</td><td><strong>' + soData(r.data_fim_nova) + '</strong></td></tr>' +
    (r.valor !== null && r.valor !== undefined ? '<tr><td>Valor pago</td><td>' + moedaCash(r.valor) + '</td></tr>' : '') +
    (r.observacao ? '<tr><td>Observação</td><td>' + escapeHtml(r.observacao) + '</td></tr>' : '') +
    '<tr><td>Emitido em</td><td>' + escapeHtml(dataHora(r.criado_em)) + '</td></tr>' +
    '</table>' +
    '<div class="nota">Documento de conferência interna. Não constitui fatura fiscal.</div>' +
    '<div class="recibo-actions"><button class="btn" onclick="window.print()">Imprimir talão</button></div>' +
    '</div>';

  var box = document.getElementById('cash-recibo');
  box.innerHTML = html;
  box.scrollIntoView({ behavior: 'smooth' });
}

function loadCashHistorico() {
  var box = document.getElementById('cash-historico');
  box.innerHTML = '<div class="hint">A carregar...</div>';
  api('/licenca-cash/recibos').then(function (data) {
    cashRecibos = data.recibos || [];
    if (!cashRecibos.length) {
      box.innerHTML = '<div class="empty">Ainda não há talões emitidos.</div>';
      return;
    }
    var html = '<table><thead><tr><th>Referência</th><th>Sistema</th><th>Cliente</th><th>Nova data-fim</th><th>Valor</th><th>Emitido</th><th>Acção</th></tr></thead><tbody>';
    cashRecibos.forEach(function (r) {
      html += '<tr>' +
        '<td>' + escapeHtml(r.referencia) + '</td>' +
        '<td>' + escapeHtml(SISTEMAS_CASH[r.sistema] || r.sistema) + '</td>' +
        '<td>' + escapeHtml(r.conta_nome) + '</td>' +
        '<td>' + soData(r.data_fim_nova) + '</td>' +
        '<td>' + (r.valor !== null && r.valor !== undefined ? moedaCash(r.valor) : '—') + '</td>' +
        '<td>' + escapeHtml(dataHora(r.criado_em)) + '</td>' +
        '<td class="actions"><button onclick="verRecibo(' + r.id + ')">Ver talão</button></td>' +
        '</tr>';
    });
    html += '</tbody></table>';
    box.innerHTML = html;
  }).catch(function (e) {
    box.innerHTML = '<div class="error">' + escapeHtml(e.message) + '</div>';
  });
}

function verRecibo(id) {
  var r = null;
  cashRecibos.forEach(function (x) { if (Number(x.id) === Number(id)) r = x; });
  if (r) renderRecibo(r);
}

(function init() {
  api('/tables').then(function () { showApp(); loadTables(); }).catch(showLogin);
})();
</script>
</body>
</html>`;
