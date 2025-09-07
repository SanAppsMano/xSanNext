export function speak(text, rate = 1, pitch = 1) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const pt = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pt-br'))
            || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pt'));
  if (pt) utter.voice = pt;
  utter.lang = pt ? pt.lang : 'pt-BR';
  utter.rate = rate;
  utter.pitch = pitch;
  speechSynthesis.speak(utter);
}
