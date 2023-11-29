import * as fs from 'fs';
import * as vscode from 'vscode';
import fsPromises from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import ignore from 'ignore';
import * as yaml from 'js-yaml';

async function replaceTextInFile(searchBlock: string, replacementBlock: string, filePath: string) {
  try {
    // Read the contents of the file
    let data = await fs.promises.readFile(filePath, 'utf8');

    // Replace the block of text
    const updatedData = data.replace(searchBlock, replacementBlock);

    // Write the updated content back to the file
    await fs.promises.writeFile(filePath, updatedData, 'utf8');

    console.log('File updated successfully.');
  } catch (err) {
    console.error('Error occurred:', err);
  }
}

let getValidFiles = async () => {
    if(!vscode.workspace.workspaceFolders){
        return [];
    }

    let rootDirectory = vscode.workspace.workspaceFolders![0].uri.fsPath;
    
    // get first order directories

    const directSubdirectories = (await fsPromises.readdir(rootDirectory, {withFileTypes: true}))
    .filter(dirent => dirent.isDirectory())
    .map(dir => dir.name);

    console.log(directSubdirectories);

    let gitignores = [".gitignore"];
    for(var i = 0; i < directSubdirectories.length; i++){
        gitignores.push(path.join(directSubdirectories[i], ".gitignore"));
    }

    console.log("Gitignore exists: ", gitignores);

    // return [];

    let toIgnore: string[] = [];

    for(var i = 0; i < gitignores.length; i++){
        try {
            let currentGitignorePath = path.join(rootDirectory, gitignores[i]);
            let gitignoreContent = await fsPromises.readFile(currentGitignorePath, {encoding: 'utf-8'});
            let rules = gitignoreContent.split("\n");
            
            let fullRules = []; 

            for(var j = 0; j < rules.length; j++){
                if(rules[j].length > 0 && !rules[j].startsWith("#")){
                    fullRules.push(path.join(path.dirname(gitignores[i]), rules[j]));
                }
            }
            toIgnore = [...toIgnore, ...rules];
            console.log("Gitignore file: " + gitignoreContent);
        } catch (e) {
            console.error(e);
            console.log("Presumed: gitignore doesn't exist here.");
        }
    }

    console.log("To ignore: ", toIgnore);

    // return [];

    let compliantFiles = fg.sync("**/*.*", {cwd: rootDirectory, ignore: toIgnore});
    console.log("Compliant files: ", compliantFiles);
    // return [];
    return compliantFiles;
}

export interface TreeNode {
    name: string;
    children?: TreeNode[];
}
  
export async function buildTree(): Promise<TreeNode[]> {
    let filePaths = await getValidFiles();

    const root: TreeNode[] = [];

    for (const filePath of filePaths) {
        const parts = filePath.split('/');

        let currentNode = root;

        for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const existingNode = currentNode.find(node => node.name === part);

        if (existingNode) {
            // Node already exists, move to the next level
            currentNode = existingNode.children || [];
        } else {
            // Create a new node
            const newNode: TreeNode = {
            name: part,
            children: i === parts.length - 1 ? undefined : []
            };

            currentNode.push(newNode);
            currentNode = newNode.children || [];
        }
        }
    }

    return root;
}

export async function buildTreeYaml(): Promise<string> {
    const tree = await buildTree();
    return yaml.dump(tree);
}

export default replaceTextInFile;