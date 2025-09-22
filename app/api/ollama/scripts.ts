import { callOllama, DEFAULT_HOST } from "./call";

export async function generatePlan(input: string, model: string) {
  return callOllama(
    model,
    `Create a plan for a webpage for me. I want some nice flow on the page and I wanna impress everyone. The page is about: ${input}`,
    false
  );
}

export async function generateCode(plan: string, model: string) {
  return callOllama(
    model,
    `Create a webpage based on the following plan. The code should be in a single HTML file with embedded CSS and JavaScript. 
    The page should be visually appealing and user-friendly. You are allowed to be creative and implement innovative ideas. Here is the plan: ${plan}`,
    false
  );
}

type OllamaTagResponse = {
  models?: Array<{
    name?: string;
  }>;
};

export async function listModels(host: string = DEFAULT_HOST) {
  const base = host.endsWith("/") ? host.slice(0, -1) : host;
  const response = await fetch(`${base}/api/tags`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Ollama models (${response.status})`);
  }

  const payload = (await response.json()) as OllamaTagResponse;
  const names = Array.isArray(payload.models)
    ? payload.models
        .map((modelEntry) => modelEntry?.name?.trim())
        .filter((name): name is string => Boolean(name))
    : [];

  return names;
}

// export async function buildWebpage(input: string, model: string) {
//   const plan = await generatePlan(input, model);
//   const code = await generateCode(plan, model);
//   return { plan, code };
// }
