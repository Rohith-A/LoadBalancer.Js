# LoadBalancer.Js

A dynamic load balancer for Node.js applications that optimizes CPU and memory allocation between I/O and CPU-bound tasks. This library is designed to use multiple cores efficiently, adjusting resource allocation based on workload for optimal performance and resource utilization.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
  - [Basic Setup](#basic-setup)
  - [Functions](#functions)
- [Example Usage](#example-usage)
  - [Setting Up a Load-Balanced Server](#setting-up-a-load-balanced-server)
  - [Adding an I/O Bound Route](#adding-an-io-bound-route)
  - [Monitoring Health and Memory Usage](#monitoring-health-and-memory-usage)
- [API Documentation](#api-documentation)
- [Configuration](#configuration)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Dynamic Resource Allocation**: Automatically adjusts CPU and memory usage between I/O and CPU-bound tasks based on availability.
- **Cluster Management**: Manages cluster workers dynamically for optimal performance and fault tolerance.
- **Memory Optimization**: Tracks memory usage and adapts resource allocation to avoid memory overload.
- **Scalable**: Supports concurrent tasks with task queuing for efficient processing.
- **Customizable**: Easily adaptable to different CPU and memory configurations.

---

## Installation

To install this package, run:

## Usage
Import the package in your application:

const { startLoadBalancer, manageCpuBoundTasks, getMemoryUsage, dynamicResourceAllocator } = require('dynamic-load-balancer');

Functions
The main functions provided by the package are:

startLoadBalancer(app, port):

Starts the load balancer, dynamically managing the allocation of workers for CPU and I/O tasks.
Accepts an Express application instance (app) and a port number (port).
manageCpuBoundTasks(taskQueue):

Returns an async function to manage CPU-bound tasks by dynamically allocating cores based on current availability and memory.
Accepts a taskQueue array to handle queued CPU-bound tasks.
getMemoryUsage():

Returns the current memory usage of the application.
dynamicResourceAllocator():

Periodically reallocates resources between I/O and CPU-bound tasks for optimal usage.

## Example Usage

const express = require('express');
const path = require('path');
const { startLoadBalancer, manageCpuBoundTasks, getMemoryUsage } = require('dynamic-load-balancer');

const app = express();
const port = 3000;
const taskQueue = []; // Task queue for CPU-bound tasks

// Initialize CPU task manager
const handleCpuTask = manageCpuBoundTasks(taskQueue);
\\code
// Example route for a CPU-bound task
app.get('/compute-heavy-task', async (req, res) => {
    try {
        const result = await handleCpuTask(path.resolve(__dirname, './heavyTaskWorker.js'), { data: 10000 });
        res.json({ result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the load balancer with the app
startLoadBalancer(app, port);

## API Documentation

API Documentation
startLoadBalancer(app, port)
Description: Initializes a dynamic load balancer with core allocation adjustments for CPU and I/O tasks.
Parameters:
app: The Express app instance.
port: The port to run the server on.
manageCpuBoundTasks(taskQueue)
Description: Manages the execution of CPU-bound tasks using available cores.
Returns: An async function that executes tasks and reallocates resources dynamically.
Usage:
This function returns an async function which you can call with a path to a worker script and any workerData.
getMemoryUsage()
Description: Returns the current memory usage in bytes.
Returns: Number - The memory usage of the current Node.js process.
dynamicResourceAllocator()
Description: Adjusts the allocation of CPU cores and memory between I/O and CPU-bound tasks at regular intervals for efficient usage.
Usage: Typically used internally by startLoadBalancer, but can also be called independently to trigger resource reallocation manually.

```bash
npm install dynamic-load-balancer
