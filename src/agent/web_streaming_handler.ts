const { BaseCallbackHandler } = require("langchain/callbacks");
const { Serialized } = require("langchain/load/serializable");
const {
  BaseMessage,
  HumanMessage,
  SystemMessage,
  AIMessage
} = require("langchain/schema");
const { Webview } = require("vscode");
const { LLMResult } = require("langchain/schema");


export class WebStreamingHandler extends BaseCallbackHandler {
    name = "web_streaming_handler";
    messages: typeof BaseMessage[] = [];
    webview?: typeof Webview;

    setWebview(wv: typeof Webview){
        this.webview = wv;
    }

    handleLLMStart(){
        this.messages.push(new AIMessage({content: "", name: "ai"}));
    }

    handleLLMNewToken(token: string){
        // console.log("Running handleLLMNewToken: ", token);
        if(this.messages.at(-1)?.name == "human"){
            this.messages.push(new AIMessage({content: "", name: "ai"}));
        }
        this.messages.at(-1)!.content += token;
        this.updateFrontend();
    }

    handleLLMEnd(output: typeof LLMResult, runId: string){
        console.log("Finished running LLM");
    }

    resetMessages(){
        this.messages = [];
        this.updateFrontend();
    }

    getMessages(): typeof BaseMessage[]{
        return this.messages;
    }

    removeMessage(index: number){
        this.messages.splice(index, 1);
        this.updateFrontend();
    }

    addHumanMessage(message: string){
        this.messages.push(new HumanMessage({
            content: message,
            name: "human"
        }));
        this.updateFrontend();
    }

    addAssistantMessage(message: string){
        this.message.push(new AIMessage({
            content: message,
            name: "ai"
        }));
        this.updateFrontend();
    }

    updateFrontend(){
        let messagesJson = [];
        for(var i = 0; i < this.messages.length; i++){
            messagesJson.push({
                content: this.messages[i].content,
                from: this.messages[i].name,
                to: ""
            });
        }
        console.log("Updating frontend with: ", this.messages, messagesJson);
        this.webview?.postMessage({
            type: "messages",
            content: messagesJson
        })
    }
    
    handleToolStart(tool: typeof Serialized, input: string, runId: string, name?: string) {
        // every single tool request
        console.log("Tool start: ", tool, input, name);
        this.messages.push(new AIMessage({
            content: `Calling tool: ${name} with input ${input}. \n Please provide feedback or press enter to continue.`,
            name: "ai"
        }));
        this.updateFrontend();
    }

    handleToolEnd(output: string, runId: string) {
        this.messages.push(new HumanMessage({
            content: output,
            name: "human"
        }));
        this.updateFrontend();
    }

    handleToolError(err: any, runId: string, parentRunId?: string, tags?: string[]) {
        this.messages.push(new HumanMessage({
            content: "Error: " + err.toString(),
            name: "human"
        }));
        this.updateFrontend();
    }
}