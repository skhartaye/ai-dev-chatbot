export function summarizeUsage(rows) {
  const result={requests:rows.length,complete:0,active:0,failed:0,total:0,input:0,output:0,reported:0,models:new Map()};
  const count=value=>Number.isFinite(value)&&value>=0?value:0;
  for(const row of rows) {
    if(row.status==='complete')result.complete++;
    if(['queued','processing'].includes(row.status))result.active++;
    if(row.status==='failed')result.failed++;
    if(row.status!=='complete'||!Number.isFinite(row.usage?.totalTokenCount)||row.usage.totalTokenCount<0)continue;
    result.reported++;result.total+=row.usage.totalTokenCount;
    result.input+=count(row.usage.promptTokenCount);result.output+=count(row.usage.candidatesTokenCount);
    if(row.model)result.models.set(row.model,(result.models.get(row.model)||0)+1);
  }
  return result;
}
