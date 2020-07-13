#!/usr/bin/env node
import * as cdk from '@aws-cdk/core';
import { StepfunctionsExpressWorkflowStack } from '../lib/stepfunctions-express-workflow-stack';

const app = new cdk.App();
new StepfunctionsExpressWorkflowStack(app, 'StepfunctionsExpressWorkflowStack');
