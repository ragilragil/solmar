// Keyboard and mouse state for the canvas game. Keys report two ways: down()
// is true while held, pressed() is true once, on the frame the key went down,
// and is then consumed. Mouse clicks work the same way. The game loop calls
// endFrame() after each update so a press never fires twice.
export function createInput(canvas) {
  const held = {};
  const hit = {};
  const mouse = { x: 0, y: 0, down: false, left: false, right: false };

  function codeOf(event) {
    return event.code || '';
  }

  window.addEventListener('keydown', (event) => {
    const code = codeOf(event);
    if (!code) return;
    if (!held[code]) hit[code] = true;
    held[code] = true;
    if (code === 'Space' || code.startsWith('Arrow')) event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    held[codeOf(event)] = false;
  });
  window.addEventListener('blur', () => {
    for (const code of Object.keys(held)) held[code] = false;
  });

  function track(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  }
  canvas.addEventListener('mousemove', track);
  canvas.addEventListener('mousedown', (event) => {
    track(event);
    mouse.down = true;
    if (event.button === 0) mouse.left = true;
    if (event.button === 2) mouse.right = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  function down(code) {
    return !!held[code];
  }
  function pressed(code) {
    if (hit[code]) {
      hit[code] = false;
      return true;
    }
    return false;
  }
  function clickedLeft() {
    if (mouse.left) {
      mouse.left = false;
      return true;
    }
    return false;
  }
  function clickedRight() {
    if (mouse.right) {
      mouse.right = false;
      return true;
    }
    return false;
  }
  function endFrame() {
    for (const code of Object.keys(hit)) hit[code] = false;
    mouse.left = false;
    mouse.right = false;
  }

  return { down, pressed, clickedLeft, clickedRight, endFrame, mouse };
}
