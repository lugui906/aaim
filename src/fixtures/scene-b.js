localStorage.clear(); Memory.clear(); LocalFiles.files.clear(); Artifacts.length = 0;
const s = State.current();
s.title = '出报表并解释思路';
const cfg = '{"port":8080}';
const b1 = new Blob(['x'], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
const b2 = new Blob(['y'], {type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
const a1 = addArtifact({name:'季度报价表.xlsx', mime:MIME.xlsx, size:18432, blob:b1, kind:'xlsx'});
const a2 = addArtifact({name:'汇报演示.pptx', mime:MIME.pptx, size:76420, blob:b2, kind:'pptx'});
s.messages.push({role:'user', content:'把三个方案做成 Excel，再配一页 PPT 汇报', ts:Date.now()});
s.messages.push({role:'assistant', content:'', step:1, ts:Date.now(),
  thinking:'用户要两个交付物。先算好三行的数据，再分别调用表格与演示工具。注意金额要按套数乘单价，不能写错单位。',
  tool_calls:[{id:'c1',name:'generate_xlsx',arguments:{filename:'季度报价表.xlsx'}},{id:'c2',name:'generate_pptx',arguments:{filename:'汇报演示.pptx'}}]});
s.messages.push({role:'tool', name:'generate_xlsx', tool_call_id:'c1', ok:true, ms:142, content:'x', display:{kind:'file', art:a1}});
s.messages.push({role:'tool', name:'generate_pptx', tool_call_id:'c2', ok:true, ms:1180, content:'x', display:{kind:'file', art:a2}});
s.messages.push({role:'tool', name:'web_search', tool_call_id:'c3', ok:false, ms:920, content:'timeout',
  display:{kind:'search', provider:'deepseek', query:'x', results:[], errs:['tavily: 未配置 Key']}});
s.messages.push({role:'assistant', step:2, ts:Date.now(), tool_calls:[],
  content:'两个文件都做好了，点上面的卡片可直接下载。\n\n**表格**：三个方案各一行，含套数、单价、小计。\n\n**PPT**：一页封面 + 一页对比表。\n\n> 备注：搜索那一步失败了（没配 Tavily Key），但不影响交付物。'});
UI.renderMessages(); UI.renderSessions(); UI.updateHeader();
document.querySelector('#stream').scrollTop = 0;
return 1;
