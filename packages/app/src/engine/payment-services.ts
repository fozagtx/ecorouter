import type { Service } from "./types";

export function servicesNeedingApproval(services: Service[], allowed: string[]): Service[] {
  return services.filter((service) => !service.suspended && !allowed.includes(service.id));
}
