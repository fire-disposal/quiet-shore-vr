/**
 * The application level: a product surface that can own the main area.
 *
 * Training is the existing session console; the questionnaire is its own
 * product face with its own guide and records. The shell (top bar, rail) does
 * not change when the app does.
 */
export type AppId = 'training' | 'questionnaire';

export const APP_IDS: readonly AppId[] = ['training', 'questionnaire'];

export function isAppId(value: string): value is AppId {
  return value === 'training' || value === 'questionnaire';
}

export function appLabel(id: AppId): string {
  return id === 'questionnaire' ? '问卷' : '训练';
}
