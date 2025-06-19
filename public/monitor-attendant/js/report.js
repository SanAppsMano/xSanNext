// public/monitor-attendant/js/report.js

document.addEventListener('DOMContentLoaded', () => {
  const params = new URL(location).searchParams;
  const token = params.get('t');
  if (!token) return;

  const enteredList   = document.getElementById('entered-list');
  const cancelledList = document.getElementById('cancelled-list');
  const missedList    = document.getElementById('missed-list');
  const attendedList  = document.getElementById('attended-list');
  const fmt = ts => new Date(ts).toLocaleTimeString();

  function itemText(ticket, name) {
    return name ? `${ticket} - ${name}` : String(ticket);
  }

  async function load() {
    try {
      const [enRes, caRes, atRes] = await Promise.all([
        fetch(`/.netlify/functions/entradas?t=${token}`),
        fetch(`/.netlify/functions/cancelados?t=${token}`),
        fetch(`/.netlify/functions/atendidos?t=${token}`)
      ]);
      const { entered = [] } = await enRes.json();
      const { cancelled = [], missed = [] } = await caRes.json();
      const { attended = [] } = await atRes.json();

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

  load();
});
