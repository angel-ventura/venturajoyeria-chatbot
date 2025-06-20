import pkg from "@pinecone-database/pinecone";

const { Pinecone } = pkg;

/**
 * Initialize Pinecone and return an index instance.
 * Throws an error if required environment variables are missing.
 */
export function getPineconeIndex() {
  const { PINECONE_API_KEY, PINECONE_ENVIRONMENT, PINECONE_INDEX } = process.env;
  if (!PINECONE_API_KEY || !PINECONE_ENVIRONMENT || !PINECONE_INDEX) {
    throw new Error(
      "Missing Pinecone configuration. Please set PINECONE_API_KEY, " +
      "PINECONE_ENVIRONMENT and PINECONE_INDEX in your environment."
    );
  }

  const pinecone = new Pinecone({
    apiKey:            PINECONE_API_KEY,
    controllerHostUrl: `https://controller.${PINECONE_ENVIRONMENT}.pinecone.io`
  });
  return pinecone.Index(PINECONE_INDEX, "");
}
