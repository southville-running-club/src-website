// Keyboard shortcuts for the check screen. Everything here is also a visible, labelled
// button, and every button works with scripting off; this only saves reaching for the
// mouse when checking a few hundred photos.
//
// A button marked data-key="N" is pressed by that key. Digits with no button of their own
// go into the "Type the bib" box, so typing a number corrects the read. Nothing happens
// while somebody is typing in a box, or while a button or link has focus and they press
// Enter or Space, because then the browser is already doing the right thing.
'use strict';

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (
    (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) &&
    (event.key === 'Enter' || event.key === ' ')
  ) {
    return;
  }

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const button = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (button instanceof HTMLButtonElement) {
    event.preventDefault();
    button.click();
    return;
  }

  const box = document.querySelector('[data-correction]');
  if (/^[0-9]$/.test(event.key) && box instanceof HTMLInputElement) {
    event.preventDefault();
    box.focus();
    box.value += event.key;
  }
});
