import {z} from 'zod';

// Preview qualification is local IPC only. Never accept network endpoints from
// a model, document, or native tool response as new connection authority.
export const ipcAddressSchema=z.string().max(4096).regex(/^ipc:\/\/\/[^\0\r\n]+$/);
const bindingReport=z.object({
  ipc_address:ipcAddressSchema,ipc_available:z.literal(true),kicad_ui_running:z.literal(true),
  requested_open:z.literal(true),requested_path:z.string(),requested_board:z.string(),
  requested_check_error:z.null(),open_boards_error:z.null(),
  open_board_count:z.number().int().positive().max(100),
  open_boards:z.array(z.string().min(1).max(4096)).min(1).max(100),
});

export async function observeKonnectBinding(connection,target,expectedIpcAddress){
  ipcAddressSchema.parse(expectedIpcAddress);
  if(!connection.tools?.some(t=>t.name==='open_project'))throw Error('Native document binding capability unavailable');
  // Despite the historical name, the reviewed tool only queries open documents.
  const report=bindingReport.parse(await connection.call('open_project',{path:target.path}));
  if(report.ipc_address!==expectedIpcAddress||report.requested_path!==target.path||report.requested_board!==target.path||
    report.open_board_count!==report.open_boards.length||new Set(report.open_boards).size!==report.open_boards.length||
    report.open_boards.filter(path=>path===target.path).length!==1)throw Error('Native editor/document binding changed');
  return {ipcAddress:expectedIpcAddress,documentPath:target.path};
}
