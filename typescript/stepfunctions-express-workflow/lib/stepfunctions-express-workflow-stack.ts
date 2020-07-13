import * as cdk from '@aws-cdk/core';
import * as lambda from '@aws-cdk/aws-lambda';
import * as lambda_sources from '@aws-cdk/aws-lambda-event-sources';
import * as logs from '@aws-cdk/aws-logs';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as sfn_tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as sqs from '@aws-cdk/aws-sqs';
import * as fs from 'fs';


export class StepfunctionsExpressWorkflowStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // Example of an in-line Lambda Function, this approach doesn't generate an asset and can be
    // used to create a CloudFormation Template that can be re-deployed into any AWS Account/Region
    const base64DecodeFunction = new lambda.Function(
      this, 
      "Base64DecodeLambda", 
      {
        runtime: lambda.Runtime.PYTHON_3_7,
        handler: 'index.lambda_handler',
        code: lambda.Code.fromInline(`
import base64
def lambda_handler(event, context):
    return {
        'statusCode': 200,
        'input': event['input'],
        'output': base64.b64decode(event['input']).decode('utf-8')
    }
        `),
        timeout: cdk.Duration.seconds(20)
      }
    )

    // Example of an inline Lambda Function that is read from a local file. This offers the
    // benefit of keeping application code out of infrasturcture code, while also generating
    // environment agnostic tempaltes.
    const removeSpecialCharactersFunction = new lambda.Function(
      this, 
      "RemoveSpecialCharactersLambda", 
      {
        runtime: lambda.Runtime.PYTHON_3_7,
        handler: 'app.lambda_handler',
        // The path is relative to the location of the package.json file.
        code: lambda.Code.fromInline(fs.readFileSync('./functions/remove_special_characters/app.py','utf8')),
        timeout: cdk.Duration.seconds(20)
      }
    )

    // Example of an asset Lambda Function, this approach will have CDK grab the contents of the 
    // directory specified in the `.fromAsset()` method, zip the directory, and upload it prior,
    // to deploying the CFN Template. This approach is useful for Lambda Functions containing 
    // external dependencies or multiple files.
    const generateStatisticsFunction = new lambda.Function(
      this, 
      "GenerateStatisticsLambda", 
      {
        runtime: lambda.Runtime.PYTHON_3_7,
        handler: 'app.lambda_handler',
        // The path is relative to the location of the package.json file.
        code: lambda.Code.fromAsset('./functions/generate'),
        timeout: cdk.Duration.seconds(20)
      }
    )
    
    const decodeBase64StringJob = new sfn_tasks.LambdaInvoke(
      this, 
      'DecodeBase64String',
      {
        lambdaFunction: base64DecodeFunction,
        outputPath: "$.Payload"
      }
    )

    const removeSpecialCharactersJob = new sfn_tasks.LambdaInvoke(
      this, 
      'removeSpecialCharacters',
      {
        lambdaFunction: removeSpecialCharactersFunction,
        outputPath: "$.Payload"
      }
    )

    const generateStatisticsJob = new sfn_tasks.LambdaInvoke(
      this, 
      'generateStatistics',
      {
        lambdaFunction: generateStatisticsFunction,
        outputPath: "$.Payload"
      }
    )

    const tokenizeAndCountJob = new sfn_tasks.LambdaInvoke(
      this, 
      'tokenizeAndCount',
      {
        // Here we have defined the Lambda Function inside a StepFunction Job, think of this like an 
        // anonymous inner function
        lambdaFunction: new lambda.Function(
          this, 
          "TokenizeAndCountLambda", 
          {
            runtime: lambda.Runtime.PYTHON_3_7,
            handler: 'app.lambda_handler',
            // The path is relative to the location of the package.json file.
            code: lambda.Code.fromAsset('./functions/tokenize'),
            timeout: cdk.Duration.seconds(20)
          }
        ),
        outputPath: "$.Payload"
      }
    )
    
    const definition = decodeBase64StringJob.next(generateStatisticsJob).next(removeSpecialCharactersJob).next(tokenizeAndCountJob)
    
    const expressStateMachine = new sfn.StateMachine(
            this,
            'ExpressStateMachineForTextProcessing',
            {
              stateMachineType: sfn.StateMachineType.EXPRESS,
              definition: definition,
              logs: {
                level: sfn.LogLevel.ALL,
                destination: new logs.LogGroup(this, "ExpressLogGroup"),
                includeExecutionData: true
              }
            }
        )

    const queue = new sqs.Queue(this, "SQSQueue")
    
    const triggerOnSQSQueueLambda = new lambda.Function(
      this, 
      "TriggerOnSQSQueueLambda", 
      {
        runtime: lambda.Runtime.PYTHON_3_7,
        handler: 'index.lambda_handler',
        code: lambda.Code.fromInline(`
import boto3
def lambda_handler(event, context):
    message_body = event['Records'][0]['body']
    client = boto3.client('stepfunctions')
    response = client.start_execution(
        stateMachineArn='${expressStateMachine.stateMachineArn}',
        input=message_body
    )
        `)
      }
    )
    expressStateMachine.grantStartExecution(triggerOnSQSQueueLambda)
    const eventSource = triggerOnSQSQueueLambda.addEventSource(new lambda_sources.SqsEventSource(queue));
  }
}