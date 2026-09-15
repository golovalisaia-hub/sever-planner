export const SEVER_MANIFEST = {
  version:4,
  pages:{today:'Сегодня: задачи дня',calendar:'Календарь',notes:'Заметки и папки',timer:'Таймер фокуса',progress:'Прогресс',habits:'Привычки',money:'Финансы: бюджет, операции, регулярные платежи, долги и накопления',settings:'Настройки'},
  guideTargets:['create-task','notes','timer','progress','settings','ai-button'],
  ownerTools:['system.getStatus','sync.getHealth','ai.getStatus','ai.getUsage'],
  userTools:['task.create','task.update','task.move','task.complete','task.delete','task.get','calendar.get','note.create','note.update','note.delete','note.get','habit.list','habit.create','habit.update','habit.check','habit.delete','timer.start','timer.stop','timer.get','progress.get','plan.create','plan.get','navigation.open','guide.highlight','memory.remember']
} as const;
export function toolsFor(page:string,role:'owner'|'user',message='') {
  const tools=['navigation.open','guide.highlight'];
  if(page==='notes'||/замет|запис/i.test(message))tools.push('note.create','note.update','note.delete','note.get','plan.create');
  if(page==='habits'||/привыч|habit|отмет|серия/i.test(message))tools.push('habit.list','habit.create','habit.update','habit.check','habit.delete');
  if(page==='timer'||/таймер|фокус/i.test(message))tools.push('timer.start','timer.stop','timer.get');
  if(page==='progress'||/прогресс|статист|выполнил/i.test(message))tools.push('progress.get');
  if(page==='money'||/финанс|бюджет|расход|доход|платеж|платёж|подписк|цель|накоп|долг|план/i.test(message))tools.push('plan.create','plan.get');
  if(/запомни/i.test(message))tools.push('memory.remember');
  if(!['notes','timer','habits'].includes(page)||/задач|трениров|календар|завтра|пятниц|сегодня|перенес/i.test(message))
    tools.push('task.create','task.update','task.move','task.complete','task.delete','task.get','calendar.get');
  if(role==='owner'&&/систем|синхрон|провайдер|provider|ошибк|запрос|модел/i.test(message))tools.push(...SEVER_MANIFEST.ownerTools);
  return [...new Set(tools)];
}
