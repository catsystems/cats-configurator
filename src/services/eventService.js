import { EVENT_KEYS } from "@/modules/settings.js";

export function getEvents() {
  EVENT_KEYS.forEach((key) => window.cats.board.getEvents(key));
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

    window.cats.board.setConfig(key, values.join());
  });

  window.cats.board.save();
}
