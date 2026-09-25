// Russian texts for public error codes. Core code never contains user-facing
// strings (D6); channel adapters translate codes through a locale catalogue.

import type { ErrorCode } from '../../core/errors.ts';

export const ruErrors: Record<ErrorCode, string> = {
  VALIDATION: 'Проверьте введённые данные.',
  UNKNOWN_FIELD: 'Запрос содержит неизвестное поле.',
  FORBIDDEN_FIELD: 'Запрос содержит недопустимое поле.',
  INVALID_TIMEZONE: 'Не удалось распознать часовой пояс.',
  TIMEZONE_REQUIRED: 'Сначала укажите свой часовой пояс.',
  NOT_FOUND: 'Запись не найдена.',
  VERSION_CONFLICT: 'Запись уже изменилась. Обновите данные и повторите.',
  UNDO_CONFLICT: 'Отменить нельзя: запись изменилась после этого действия.',
  ACTION_EXPIRED: 'Предложение устарело. Отправьте запрос заново.',
  UNDO_EXPIRED: 'Время для отмены прошло.',
  INVALID_STATE: 'Это действие уже нельзя выполнить.',
  INVALID_REFERENCE: 'Связанная запись не найдена.',
  DUPLICATE: 'Такая запись уже есть.',
  IDENTITY_TAKEN: 'Этот аккаунт уже привязан к другому профилю.',
  IMMUTABLE_FIELD: 'Это поле нельзя изменить.',
  CONTEXT_REQUIRED: 'Внутренняя ошибка доступа.',
  IDENTITY_UNVERIFIED: 'Не удалось подтвердить вход.',
  DATABASE_ERROR: 'Сервис временно недоступен. Попробуйте позже.',
  INTERNAL: 'Что-то пошло не так. Попробуйте позже.',
};
