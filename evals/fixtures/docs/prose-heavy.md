# Onboarding Guide for New Backend Engineers

## Introduction and Purpose

Welcome to the team! It is important to note that this document is intended to serve as a comprehensive introduction to the way that our backend systems are organized, the conventions that we have adopted over the years, and the practical steps that you will need to follow in order to become productive as quickly as possible. We would really appreciate it if you could take the time to read through this entire document carefully, because the majority of the questions that new engineers tend to ask during their first few weeks are actually answered somewhere in this guide.

In addition, you should keep in mind that this document is a living artifact. It is updated on a regular basis by the platform team, and as a result, it is generally a good idea to check back every so often in order to make sure that you are not relying on information that has become outdated.

## Development Environment Setup

Before you are able to run any of our services locally, you will need to make sure to install a number of dependencies. First and foremost, you should install Node.js version 20.11.0 or newer, because all of our backend services are written in TypeScript and executed on the Node runtime. It is also worth noting that we use pnpm rather than npm for package management, due to the fact that pnpm provides significantly faster installs and a much more efficient disk usage model when working across multiple packages in our monorepo.

Once you have installed the runtime, you should clone the repository and run the bootstrap script. In most cases, this process takes approximately 10 minutes on a fresh machine. In the event that the bootstrap script fails, the most common cause is a missing or misconfigured Docker installation, so it is generally a good idea to verify that Docker Desktop is running before you attempt to troubleshoot anything else.

## Service Architecture Overview

Our platform is essentially composed of a number of relatively small services that communicate with each other over HTTP and, in certain specific cases, over a message queue. The API gateway is responsible for terminating TLS, performing authentication checks, and routing requests to the appropriate downstream service. Each and every request that enters the system passes through the gateway first, and as a result, the gateway is also the place where we apply rate limiting and request logging in a consistent manner.

The user service owns all of the data that is related to user accounts, profiles, and preferences. It is important to remember that no other service is permitted to access the user database directly; in the event that another service needs user data, it must request that data through the user service API. This rule exists due to the fact that we have been burned in the past by services that reached directly into databases that they did not own, which made schema migrations extremely painful and risky for everyone involved.

The billing service is responsible for subscription management, invoice generation, and payment processing. It communicates with our payment provider through a webhook integration, and it is worth noting that the webhook handler is one of the most sensitive pieces of code in the entire platform, because errors in that code path have the potential to result in customers being charged incorrectly.

## Deployment Process and Conventions

We deploy to production on a daily basis, and in most cases the process is completely automated. When you merge a pull request into the main branch, the continuous integration pipeline will build the affected services, run the full test suite, and then deploy the new version to the staging environment automatically. After the staging deployment has completed successfully, the pipeline waits for a period of approximately 30 minutes while automated smoke tests and canary analysis are performed, and subsequent to that waiting period, the release is promoted to production without any manual intervention.

In the event that you need to roll back a release, you should use the deployment dashboard rather than attempting to revert commits manually. The dashboard maintains a complete history of every release, and rolling back through the dashboard is able to restore the previous version in approximately 2 minutes. Reverting commits manually, on the other hand, requires a full build and test cycle, which generally takes a great deal longer.

## On-Call Expectations

Every engineer on the team participates in the on-call rotation after they have been with the team for a period of three months. The rotation is weekly, and it is important to note that the expectation is not that you will be able to fix every problem yourself; rather, the expectation is that you will be able to triage incoming alerts, mitigate customer impact whenever it is possible to do so, and escalate to the appropriate subject matter expert in the event that the problem is outside of your area of expertise.
