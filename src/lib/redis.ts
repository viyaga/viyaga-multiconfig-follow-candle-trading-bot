import { Redis } from "@upstash/redis";
import { env } from "../config";

export const redis = new Redis({
    url: env.KV_REST_API_URL,
    token: env.KV_REST_API_TOKEN
});
