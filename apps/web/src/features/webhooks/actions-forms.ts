'use server';

import { IDLE } from '@/lib/feedback/action-result';
import { enableWebhookAction, retryDeliveryAction } from './actions';

/**
 * ODCHYLKA OD PLÁNU, oprava chyby ve výpisu: akce se stavem nejde poslat rovnou
 * do `<form action=...>`, React by jí předal `FormData` jako první argument.
 * Řádkové akce tabulek proto mají obálku se správným tvarem.
 */
export async function enableWebhookFormAction(formData: FormData): Promise<void> {
  await enableWebhookAction(IDLE, formData);
}

export async function retryDeliveryFormAction(formData: FormData): Promise<void> {
  await retryDeliveryAction(IDLE, formData);
}
