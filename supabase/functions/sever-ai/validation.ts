export class AiError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status=422) { super(message); this.code=code; this.status=status; }
}
export const fail=(code:string,message:string,status=422):never=>{throw new AiError(code,message,status);};
export function object(value:any) {
  if (!value || typeof value!=='object' || Array.isArray(value)) fail('VALIDATION','Ожидался объект.');
  if(Object.keys(value).some(key=>['__proto__','constructor','prototype','user_id','userId','role'].includes(key)))
    fail('VALIDATION','Недопустимое поле.');
  return value;
}
export function text(value:any,max=160,empty=false):string {
  if(typeof value!=='string' || value.length>max || (!empty&&!value.trim())) fail('VALIDATION','Проверьте текст.');
  return value.trim();
}
export function uuid(value:any):string {
  if(typeof value!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    fail('VALIDATION','Нужен корректный ID.');
  return value;
}
export function day(value:any):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)
    fail('VALIDATION','Нужна корректная дата.');
  return value;
}
export function clock(value:any):string|null {
  if(value===null||value==='')return null;
  if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail('VALIDATION','Нужно время ЧЧ:ММ.');
  return value;
}
export function number(value:any,min:number,max:number,integer=false):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))
    fail('VALIDATION','Число вне допустимого диапазона.');
  return value;
}
export function range(from:any,to:any) {
  const a=day(from),b=day(to);
  if(b<a||Date.parse(b)-Date.parse(a)>31*86400000)fail('VALIDATION','Выберите период до 31 дня.');
  return [a,b];
}
export function checked(result:any) {
  if(result.error) fail('DATABASE_ERROR','Не удалось сохранить или загрузить данные.',503);
  return result.data;
}
export function publicRecord(row:any) {
  if(!row)return row;
  const {user_id,secure,...safe}=row; return safe;
}
