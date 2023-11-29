const {
    AgentExecutor,
    initializeAgentExecutorWithOptions
} = require("langchain/agents");
const { ChatOpenAI } = require("langchain/chat_models/openai");
const { BaseMessage } = require("langchain/schema");
const { WebStreamingHandler } = require("./web_streaming_handler");
const { Webview } = require("vscode");
const { DynamicTool, DynamicStructuredTool } = require('langchain/tools');
const google = require('googlethis');
// const { extract, extractFromHtml } = require("@extractus/article-extractor");
const { convert } = require("html-to-text");
const { z } = require("zod");
const fetch = require("node-fetch");
const { spawn } = require("child_process");

import { buildTreeYaml } from "./../tools/file_interaction";

export class SuperdocsAgent {
    private controller: AbortController;
    private executor?: typeof AgentExecutor;
    private model: typeof ChatOpenAI;
    private callbackHandler;
    private webview?: typeof Webview;
    
    private timeLastResponseProcessed = -1;
    private mostRecentResponse = "";

    constructor(webview: typeof Webview, apiKey: string) {
        this.webview = webview;
        this.controller = new AbortController();
        this.callbackHandler = new WebStreamingHandler();
        this.callbackHandler.setWebview(webview);

        this.model = new ChatOpenAI({
            callbacks: [this.callbackHandler],
            openAIApiKey: apiKey,
            model: "gpt-4-1106-preview",
            streaming: true
        });
    }

    async waitForHumanFeedback(name: string, input: string) {
        console.log("Running waitForHumanFeedback");
        // this.callbackHandler.addAssistantMessage(`Running tool: ${name} \n With input: ${input}`);
        this.webview?.postMessage({
            type: "responseRequest",
            content: `Running tool: ${name} \n With input: ${input} \n Please provide feedback.`
        });
        console.log("Starting to wait for response");
        let requestTime = Date.now();
        while(this.timeLastResponseProcessed! < requestTime){
            console.log("Checking response: ", this.timeLastResponseProcessed, requestTime);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log("Got human response: ", this.mostRecentResponse);
        return this.mostRecentResponse;
    }

    async processResponse(response: string){
        this.timeLastResponseProcessed = Date.now();
        this.mostRecentResponse = response;
    }

    generateTools(){
        // Google search
        const googleSearchTool = new DynamicTool({
            name: "google_search",
            description: "Input keywords to search in google.",
            func: async(input: string) => {
                console.log("Running Google search tool with input: ", input);

                let humanResponse = await this.waitForHumanFeedback("Google Search", input);
                if(humanResponse.trim().length != 0){
                    console.log("Human response: ", humanResponse, " was too long.");
                    return humanResponse;
                }

                const options = {
                    page: 0,
                    safe: false,
                    parse_ads: false,
                    additional_params: {
                        hl: 'en'
                    }
                };
                const response = await google.search(input, options);
                const results = [];
                
                for(var i = 0; i < response.results.length; i++){
                    results.push({
                        "title": response.results[i].title,
                        "description": response.results[i].description,
                        "url": response.results[i].url
                    });
                }

                this.callbackHandler.addAssistantMessage(`Got result from Google.`);
                return JSON.stringify(results);
            }
        });

        // Load website content
        const getWebsiteContent = new DynamicTool({
            name: "get_website_content",
            description: "Input the URL",
            func: async(input: string) => {
                console.log("Running Get Website Content tool with input: ", input);

                let humanResponse = await this.waitForHumanFeedback("Get Website Content", input);
                if(humanResponse.trim().length != 0){
                    return humanResponse;
                }

                const response = await fetch(input);

                if(!response.ok){
                    return "There was an error loading the url: " + response.statusText;
                }

                const html = await response.text();

                return convert(html);
                // const article = await extractFromHtml(html, input);
            
                // if(article){
                //     return article.content!;
                // } else {
                //     return convert(html);
                // }
            }
        });

        // Run Shell Tool
        const shellTool = new DynamicTool({
            name: "run_shell_tool",
            description: "For short commands to get information. To run long-running processes, ask the user to run the process themselves.",
            func: async(input: string) => {
                console.log("Running Run Sheel Tool with input: ", input);

                let humanResponse = await this.waitForHumanFeedback("Run Shell Tool", input);
                if(humanResponse.trim().length != 0){
                    return humanResponse;
                }

                const child = spawn(input);

                var timeout = setTimeout(() => {
                    try {
                        console.log("Timeout");
                        process.kill(-child!.pid!, 'SIGKILL');
                        return `Exit code: ${exitCode} \n Data: ${data} \n Error: ${error} \t Timed out.`;
                    } catch (e) {
                        const returnString = `Exit code: ${exitCode} \n Data: ${data} \n Error: ${error}`;
                        return returnString + " \n Timed out, failed to end process.";
                    }
                }, 7000);

                let data = "";
                for await (const chunk of child.stdout) {
                    data += chunk;
                }

                let error = "";
                for await(const chunk of child.stderr) {
                    error += chunk;
                }

                const exitCode = await new Promise((resolve, reject) => {
                    clearTimeout(timeout);
                    child.on('close', resolve);
                })

                const returnString = `Exit code: ${exitCode} \n Data: ${data} \n Error: ${error}`;
                return returnString;
            }
        });

        return [googleSearchTool, getWebsiteContent, shellTool];
    }

    async loadAgent(){
        this.executor = await initializeAgentExecutorWithOptions(this.generateTools(), this.model, {
            agentType: "openai-functions",
            agentArgs: {
                prefix: `
                You are a helpful and skilled programming assistant that operates in the editor of the user.
                You should use code snippets when explaining how to write code in-editor.

                Find ways to solve the task step by step if you need to. Explain your plan.
                When you find an answer, verify the answer carefully. Include verifiable evidence in your evidence if possible.
                
                When your instruction starts with PLAN, write a plan without running functions to implement the users request.
                When your instruction starts with IMPLEMENT, implement the necessary elements to fulfill the users task.
                When your instruction starts with CRITIQUE, your job is 
                When your instuction does not start with these keywords, simply help the user to the best of your ability.

                Use the shell tool to get information about the user's current development environment.
                Use the search and website content tool to get information about documentation, external code, or anything else of the user.`
            }
        });
    }

    async sendMessage(input: string){
        let inputWithMessages = `Message history: ${this.callbackHandler.getMessages().toString()} \n \n User request: ${input}`;
        if(!this.executor){
            await this.loadAgent();
        }
        this.callbackHandler.addHumanMessage(input);
        console.log("Agent sendMessage, About to invoke the executor.");
        const result = await this.executor?.invoke({
            input: inputWithMessages,
            controller: this.controller.signal
        });
        console.log("Agent result: ", result);
    }

    async resetConversation(){
        this.callbackHandler.resetMessages();
        this.loadAgent();
    }

    async stopGeneration(){
        this.controller.abort();
        this.controller = new AbortController();
    }
}