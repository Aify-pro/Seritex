import type { NotificationEvent } from "@/lib/types/domain";
import { EventEnabledToggle } from "./event-enabled-toggle";
import { EventTemplateForm } from "./event-template-form";
import { SendTestButton } from "./send-test-button";

const CATEGORY_LABELS: Record<string, string> = {
  commercial: "Commercial",
  infographie: "Infographie",
  production: "Production",
  general: "Général",
};

/** Liste des événements déclenchables, groupés par catégorie. */
export function EventList({ events }: { events: NotificationEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-foreground-muted">Aucun événement enregistré.</p>;
  }

  const categories = [...new Set(events.map((e) => e.category))];

  return (
    <div className="space-y-6">
      {categories.map((category) => (
        <div key={category}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            {CATEGORY_LABELS[category] ?? category}
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {events
              .filter((e) => e.category === category)
              .map((event) => (
                <li key={event.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{event.label}</p>
                      {event.description && <p className="mt-0.5 text-xs text-foreground-muted">{event.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <SendTestButton eventKey={event.event_key} />
                      <EventEnabledToggle eventId={event.id} enabled={event.enabled} />
                    </div>
                  </div>
                  <EventTemplateForm
                    eventId={event.id}
                    subjectTemplate={event.subject_template}
                    bodyTemplate={event.body_template}
                    availableVariables={event.available_variables}
                  />
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
