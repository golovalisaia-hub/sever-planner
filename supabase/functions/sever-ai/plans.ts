import { object,text,day,number,fail } from './validation.ts';
const addDays=(date:string,count:number)=>new Date(Date.parse(date)+count*86400000).toISOString().slice(0,10);
function monthDate(date:string,n:number) {
  const d=new Date(date+'T12:00:00Z'),dayOfMonth=d.getUTCDate();
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);
  d.setUTCDate(Math.min(dayOfMonth,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));
  return d.toISOString().slice(0,10);
}
export function calculatePlan(raw:any,today:string) {
  const a=object(raw),title=text(a.title),start=day(a.startDate||today);
  const kinds=['financial_goal','reading','study','habit','project'];
  if(!kinds.includes(a.kind))fail('VALIDATION','Неизвестный тип плана.');
  const plan:any={kind:a.kind,title,data:{startDate:start,paid:0}};
  const tasks:any[]=[];
  if(a.kind==='financial_goal') {
    const target=number(a.targetAmount,0.01,100000000),budget=number(a.monthlyBudget,0.01,100000000);
    if(a.annualRate!==undefined && a.annualRate!==0)fail('CLARIFICATION','Для процентного кредита нужен отдельный расчёт ставки и минимального платежа.');
    const targetCents=Math.round(target*100),budgetCents=Math.round(budget*100),months=Math.ceil(targetCents/budgetCents);
    if(months>90)fail('VALIDATION','План длиннее 90 месяцев: увеличьте платёж или сократите цель.');
    const currency=a.currency||'RUB';if(!['RUB','EUR','USD'].includes(currency))fail('VALIDATION','Неподдерживаемая валюта.');
    const schedule=Array.from({length:months},(_,i)=>({date:monthDate(start,i),amount:Math.min(budgetCents,targetCents-i*budgetCents)/100}));
    Object.assign(plan.data,{targetAmount:target,monthlyBudget:budget,currency,months,schedule,deadline:schedule.at(-1)?.date,calculation:'Без процентов'});
    for(const payment of schedule)tasks.push({title:text(title+' · '+payment.amount+' '+currency),date:payment.date,time:null,durationMinutes:null});
  } else {
    const deadline=day(a.deadline),days=Math.floor((Date.parse(deadline)-Date.parse(start))/86400000)+1;
    if(days<1||days>90)fail('VALIDATION','Выберите период от 1 до 90 дней.');
    const duration=a.durationMinutes===undefined?30:number(a.durationMinutes,1,600,true);
    const total=a.targetUnits===undefined?null:number(a.targetUnits,1,100000,true);
    const unitsPerDay=total?Math.ceil(total/days):null;
    Object.assign(plan.data,{deadline,days,targetUnits:total,unitsPerDay,durationMinutes:duration});
    for(let i=0;i<days;i++) {
      const units=total?Math.min(unitsPerDay!,total-i*unitsPerDay!):null;
      if(units!==null&&units<=0)break;
      tasks.push({title:text(title+(units?' · '+units+' ед.':'')),date:addDays(start,i),time:null,durationMinutes:duration});
    }
  }
  return {plan,tasks};
}
