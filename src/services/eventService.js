import { EVENT_KEYS } from "@/modules/settings.js";
import { applyBoardValues } from "@/services/boardService.js";

export function getEvents() {
  return Promise.all(EVENT_KEYS.map((key) => window.cats.board.getEvents(key)));
}

export function setEvents(events) {
  const entries = Object.keys(events).map((key) => {
    const event = events[key];

    let values = [];
    event.actions.forEach((action) => {
      values.push(action.index);
      values.push(action.value);
    });

    if (!values.length) values = [0, 0];

    return { key, value: values.join() };
  });
  return applyBoardValues(entries);
}
