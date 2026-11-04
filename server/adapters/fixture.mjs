import {z} from 'zod';
// Test-only adapter: deliberately never registered in the production server.
export class FixtureAdapter {
  version=1;
  atomicRevisionCheck=true;
  constructor(){this.revision=1;this.value='initial';this.connected=true;this.calls=0;}
  capabilities(){return [{operation:'set-label',effect:'write',supported:true,version:1},{operation:'read-label',effect:'read',supported:true,version:1}];}
  validate(operation,args){return (operation==='set-label'?z.object({value:z.string().min(1).max(80)}):z.object({})).strict().parse(args);}
  async observe(target,input){if(!this.connected)throw Error('Disconnected');return {projectId:input.projectId,documentId:input.documentId,path:target.path,revision:String(this.revision),observedAt:Date.now(),connected:true};}
  async preview(target,input,observation){return {revision:observation.revision,summary:input.operation==='set-label'?`Set fixture label to ${input.args.value}`:'Read fixture label',confirmation:'Fixture label action v1; exact arguments only'};}
  async execute(target,input,observation){if(String(this.revision)!==observation.revision)throw Error('Atomic revision conflict');this.calls++;if(input.operation==='set-label'){this.value=input.args.value;this.revision++;}return {revision:String(this.revision),value:this.value};}
  async verify(target,input,receipt){return {verified:receipt.revision===String(this.revision)&&receipt.value===this.value};}
  async cancel(){return {supported:false,reason:'Synchronous fixture dispatch cannot be interrupted'};}
  async inspect(){return {revision:String(this.revision),value:this.value,doesNotAuthorizeReplay:true};}
  async reviewRecovery(target,action){
    if(!this.connected)throw Error('Disconnected');
    if(action.input.operation==='set-label'&&this.value!==action.input.args.value)throw Error('Fixture postcondition not established');
    return {version:1,revision:String(this.revision),basis:action.effect==='read'?'read-only-operation':'postcondition-observed',
      summary:'Current fixture value observed. This does not prove how the original action ended.',details:{value:this.value}};
  }
}
