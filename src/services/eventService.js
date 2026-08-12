import { EVENT_KEYS } from "@/modules/settings.js";
import { applyBoardValues } from "@/services/boardService.js";

export function getEvents() {
  return Promise.all(EVENT_KEYS.map((key) => window.cats.board.getEvents(key)));
}

export function setEvents(events) {
  const entries = Object.keys(events)
    .filter((key) => {
      const event = events[key];
      const values = event.actions.flatMap((action) => [
        action.index,
        action.value,
      ]);
      return event.values.join() !== values.join();
    })
    .map((key) => {
      const event = events[key];

      const values = event.actions.flatMap((action) => [
        action.index,
        action.value,
      ]);
      while (values.length < event.arrayLength) values.push(0);

      return { key, value: values.slice(0, event.arrayLength).join() };
    });
  return applyBoardValues(entries);
}
