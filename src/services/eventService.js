import { EVENT_KEYS } from "@/modules/settings.js";

export function getEvents() {
  EVENT_KEYS.forEach((key) => window.renderer.send("BOARD:EVENTS", key));
}

export function setEvents(events) {
  Object.keys(events).forEach((key) => {
    const event = events[key];

    let values = [];
    event.actions.forEach((action) => {
      values.push(action.index);
      values.push(action.value);
    });

    if (!values.length) values = [0, 0];

    window.renderer.send("BOARD:SET_CONFIG", [key, values.join()]);
  });

  window.renderer.send("BOARD:SAVE");
}
