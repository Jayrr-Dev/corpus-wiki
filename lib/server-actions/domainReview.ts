"use server";
import { runDomainReview } from "@/lib/domains/runReview";
export async function reviewDomainStructure() { return runDomainReview(); }
