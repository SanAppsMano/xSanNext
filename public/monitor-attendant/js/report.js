// public/monitor-attendant/js/report.js

document.addEventListener('DOMContentLoaded', () => {
  const params = new URL(location).searchParams;
  const token = params.get('t');
  if (!token) return;

  const enteredList   = document.getElementById('entered-list');
  const cancelledList = document.getElementById('cancelled-list');
  const missedList    = document.getElementById('missed-list');
  const attendedList  = document.getElementById('attended-list');
  const btnCsv        = document.getElementById('btn-csv');
  const btnBack       = document.getElementById('btn-back');
  const fmt = ts => new Date(ts).toLocaleTimeString();

  function itemText(ticket, name) {
    return name ? `${ticket} - ${name}` : String(ticket);
  }

  async function load() {
    try {
      const res = await fetch(`/.netlify/functions/report?t=${token}`);
      const { entered = [], cancelled = [], missed = [], attended = [] } = await res.json();

      enteredList.innerHTML = '';
      entered.forEach(({ ticket, name = '', ts }) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${itemText(ticket, name)}</span><span class="ts">${fmt(ts)}</span>`;
        enteredList.appendChild(li);
      });

      cancelledList.innerHTML = '';
      cancelled.forEach(({ ticket, name = '', ts, reason, duration, wait }) => {
        const durTxt = duration ? ` (${Math.round(duration/1000)}s)` : '';
        const waitTxt = wait ? ` [${Math.round(wait/1000)}s]` : '';
        const li = document.createElement('li');
        li.innerHTML = `<span>${itemText(ticket, name)}</span><span class="ts">${fmt(ts)}${durTxt}${waitTxt}</span>`;
        cancelledList.appendChild(li);
      });

      missedList.innerHTML = '';
      missed.forEach(({ ticket, name = '', ts, duration, wait }) => {
        const durTxt = duration ? ` (${Math.round(duration/1000)}s)` : '';
        const waitTxt = wait ? ` [${Math.round(wait/1000)}s]` : '';
        const li = document.createElement('li');
        li.classList.add('missed');
        li.innerHTML = `<span>${itemText(ticket, name)}</span><span class="ts">${fmt(ts)}${durTxt}${waitTxt}</span>`;
        missedList.appendChild(li);
      });

      attendedList.innerHTML = '';
      attended.forEach(({ ticket, name = '', ts, duration, wait }) => {
        const durTxt = duration ? ` (${Math.round(duration/1000)}s)` : '';
        const waitTxt = wait ? ` [${Math.round(wait/1000)}s]` : '';
        const li = document.createElement('li');
        li.classList.add('attended');
        li.innerHTML = `<span>${itemText(ticket, name)}</span><span class="ts">${fmt(ts)}${durTxt}${waitTxt}</span>`;
        attendedList.appendChild(li);
      });
    } catch (e) {
      console.error('Erro ao gerar relatório:', e);
    }
  }

  function toCsv(data) {
    const rows = [
      ['tipo','ticket','nome','timestamp','duracao','espera','motivo']
    ];
    data.entered.forEach(r => {
      rows.push(['entrada', r.ticket, r.name || '', new Date(r.ts).toISOString(), '', '', '']);
    });
    data.cancelled.forEach(r => {
      rows.push(['cancelado', r.ticket, r.name || '', new Date(r.ts).toISOString(), r.duration||'', r.wait||'', r.reason]);
    });
    data.missed.forEach(r => {
      rows.push(['perdeu', r.ticket, r.name || '', new Date(r.ts).toISOString(), r.duration||'', r.wait||'', 'missed']);
    });
    data.attended.forEach(r => {
      rows.push(['atendido', r.ticket, r.name || '', new Date(r.ts).toISOString(), r.duration||'', r.wait||'', '']);
    });
    return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  }

  btnCsv.onclick = async () => {
    try {
      const res = await fetch(`/.netlify/functions/report?t=${token}`);
      const data = await res.json();
      const csv = toCsv(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'relatorio.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch(e) {
      console.error('csv error', e);
    }
  };

  btnBack.onclick = () => history.back();

  load();
});
