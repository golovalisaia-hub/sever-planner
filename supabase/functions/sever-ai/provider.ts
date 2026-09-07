import { AiError,fail,object,text } from './validation.ts';

export type ProviderReply={message:string;intent:string;supportLevel:number;toolCall:null|{name:string;arguments:Record<string,unknown>}};
export interface AIProvider {
  complete(input:{system:string;message:string;context:unknown;history?:any[];signal?:AbortSignal;onText?:(text:string)=>void}):Promise<{reply:ProviderReply;usage:Record<string,number>}>;
}

// Groq exposes an OpenAI-compatible Chat Completions stream. Keeping this
// adapter protocol-based (rather than product-specific) makes replacement a
// server configuration change, never a frontend or database migration.
export class OpenAICompatibleProvider implements AIProvider {
  key:string;model:string;url:string;
  constructor(key:string,model:string,url:string){this.key=key;this.model=model;this.url=url;}
  async complete(input:any){
    const signal=AbortSignal.any([input.signal||new AbortController().signal,AbortSignal.timeout(20000)]);
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++){
      response=await fetch(this.url,{method:'POST',signal,headers:{Authorization:'Bearer '+this.key,'Content-Type':'application/json'},
        body:JSON.stringify({model:this.model,temperature:0.1,max_tokens:1100,stream:true,
          stream_options:{include_usage:true},response_format:{type:'json_object'},
          messages:[{role:'system',content:input.system},{role:'user',content:JSON.stringify({message:input.message,context:input.context,previousMessages:input.history||[]})}]})});
      if(![502,503].includes(response.status)||attempt===1)break;
      await response.body?.cancel();
    }
    if(!response!.ok)throw new AiError(response!.status===429?'RATE_LIMIT':'PROVIDER_ERROR','Sever AI сейчас недоступен. Остальные функции работают как обычно.',response!.status===429?429:503);
    if(!response!.body)fail('PROVIDER_ERROR','Пустой ответ AI.',503);
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='',usage:any={},finished=false,lastText='';
    const consume=(line:string)=>{
      if(!line.startsWith('data:'))return;
      const value=line.slice(5).trim();if(value==='[DONE]'){finished=true;return;}if(!value)return;
      let data:any;try{data=JSON.parse(value);}catch{fail('PROVIDER_ERROR','Некорректный поток AI.',503);}
      if(data.error)fail('PROVIDER_ERROR','Ошибка потока AI.',503);
      usage=data.usage||usage;content+=data.choices?.[0]?.delta?.content||'';
      if(content.length>24000)fail('PROVIDER_ERROR','Слишком длинный ответ AI.',503);
      const match=content.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if(match){try{const value=JSON.parse('"'+match[1]+'"');if(value!==lastText){lastText=value;input.onText?.(value);}}catch{}}
    };
    try{
      while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines)consume(line);if(buffer.length>32000)fail('PROVIDER_ERROR','Некорректный поток.',503);}
      if(buffer)consume(buffer);
    } finally {await reader.cancel().catch(()=>{});}
    if(!finished)fail('PROVIDER_ERROR','Ответ AI прервался. Попробуйте снова.',503);
    let reply:any;try{
      reply=object(JSON.parse(content));text(reply.message,4000);
      if(reply.toolCall){object(reply.toolCall);text(reply.toolCall.name,80);object(reply.toolCall.arguments);}
    }catch{fail('PROVIDER_ERROR','AI вернул некорректное действие. Попробуйте уточнить запрос.',503);}
    return {reply:reply as ProviderReply,usage};
  }
}
export const GroqProvider=OpenAICompatibleProvider;

export function providerConfig(env:(name:string)=>string|undefined){
  return {name:env('AI_PROVIDER')||'groq',model:env('AI_MODEL')||'openai/gpt-oss-20b',
    key:env('AI_API_KEY')||env('GROQ_API_KEY')||'',url:env('AI_BASE_URL')};
}
export function providerFromEnv(env=(name:string)=>Deno.env.get(name)){
  const config=providerConfig(env);
  if(!config.key)fail('AI_NOT_CONFIGURED','Sever AI сейчас недоступен. Остальные функции работают как обычно.',503);
  const defaultUrls:Record<string,string>={mistral:'https://api.mistral.ai/v1/chat/completions',groq:'https://api.groq.com/openai/v1/chat/completions'};
  if(!['mistral','groq','openai-compatible'].includes(config.name))fail('AI_NOT_CONFIGURED','Провайдер не настроен.',503);
  const url=config.url||defaultUrls[config.name];
  if(!url||!/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(url))fail('AI_NOT_CONFIGURED','Нужен HTTPS адрес провайдера.',503);
  return {provider:new OpenAICompatibleProvider(config.key,config.model,url),name:config.name,model:config.model};
}
