# Chat Widget for E-commerce

This project implements a sophisticated chat widget designed for e-commerce websites, specifically tailored for online stores like Ventura Joyeria. It helps users find products, get answers to their questions, and connect with customer support.

## Core Features

*   **Intelligent Query Handling:** The widget processes user queries in Spanish and can:
    *   Directly match products from the Shopify store.
    *   Display a list of products if multiple matches are found.
    *   Provide links to relevant product collections.
    *   Offer a WhatsApp contact option for direct human assistance or when explicitly requested by the user.
*   **Retrieval Augmented Generation (RAG):** For more complex queries or when direct product matches aren't found, the widget uses a RAG system. It leverages OpenAI's GPT models and a Pinecone vector database to provide AI-generated answers based on the store's data.
*   **Comprehensive Data Sources:** The information used by the chat widget is sourced from:
    *   **Shopify Admin API:** To fetch products, collections, store pages (e.g., "About Us"), shipping policies, and active discount codes.
    *   **Public Web Scraping:** To gather information from key public-facing pages of the website (e.g., homepage, refund policy).

## Project Structure

The main components of the project are:

*   `server.js`: The core Express.js server that handles incoming chat messages via the `/chat` endpoint. It orchestrates the query processing, product lookups, RAG pipeline, and response generation.
*   `index-docs.js`: A script responsible for building and maintaining the knowledge base for the RAG system. It fetches data from Shopify and public web pages, chunks the text content, generates embeddings using OpenAI, and upserts them into the Pinecone vector database. This script should be run periodically to keep the information up-to-date.
*   `fetch-shopify.js`: Contains functions to interact with the Shopify Admin API. It fetches products, pages (like "About Us"), shipping policies, and discount codes.
*   `fetch-public-pages.js`: Includes functionality to scrape content from specified public URLs using Cheerio.
*   `chunker.js`: A utility script that splits large pieces of text into smaller, more manageable chunks suitable for AI embedding models.
*   `package.json`: Defines the project's metadata, dependencies (like Express, OpenAI, Pinecone, Cheerio), and scripts (e.g., `npm start`).
*   `.env` (not committed): Used to store sensitive information like API keys and configuration details.

## Prerequisites

Before you can run this project, you'll need the following:

*   **Node.js:** (v18.x or later recommended) - Download from [nodejs.org](https://nodejs.org/)
*   **NPM:** (Usually comes with Node.js)
*   **OpenAI API Key:** For generating embeddings and chat completions.
*   **Pinecone Account:**
    *   API Key.
    *   Environment name.
    *   An active Pinecone index (e.g., `chat-widget`) configured with the correct dimension for `text-embedding-3-small` (1536).
*   **Shopify Admin API Access Token:**
    *   From a private app or a custom app in your Shopify store.
    *   Required permissions: `read_products`, `read_content` (for pages), `read_shipping` (for policies), `read_discounts` (for discount codes).
*   **Shopify Shop Name:** Your shop's unique name (e.g., `your-store.myshopify.com` - just use `your-store`).

## Setup and Running

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url>
    cd chat-widget
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root of the project. Copy the example below and replace the placeholder values with your actual credentials and configuration:
    ```env
    # OpenAI
    OPENAI_API_KEY="sk-yourOpenAiApiKey"

    # Pinecone
    PINECONE_API_KEY="yourPineconeApiKey"
    PINECONE_ENVIRONMENT="yourPineconeEnvironment" # e.g., "gcp-starter" or "us-west1-gcp"
    PINECONE_INDEX="yourPineconeIndexName" # e.g., "chat-widget"

    # Shopify
    SHOPIFY_SHOP="your-shopify-store-name" # Just the name, not the full myshopify.com domain
    SHOPIFY_ADMIN_API_TOKEN="shpat_yourShopifyAdminApiAccessToken"

    # Server (Optional)
    PORT=3001
    ```

4.  **Index Data into Pinecone:**
    Before starting the server for the first time, or whenever you need to update the knowledge base, run the indexing script:
    ```bash
    node index-docs.js
    ```
    This script will fetch data from Shopify and public URLs, chunk it, generate embeddings, and store them in your Pinecone index. This might take a few minutes depending on the amount of data.

5.  **Start the Chat Server:**
    ```bash
    npm start
    ```
    The server will typically start on `http://localhost:3001` (or the port specified in your `.env` file).

6.  **Integrate with your Frontend:**
    The chat server exposes a `/chat` endpoint that accepts POST requests with the following JSON structure:
    ```json
    {
      "messages": [
        { "role": "user", "content": "Hello" },
        { "role": "assistant", "content": "Hi there! How can I help?" },
        { "role": "user", "content": "Do you have gold chains?" }
      ]
    }
    ```
    The response will be a JSON object detailing the reply type and content. See `server.js` for the exact response structures (`product`, `productList`, `collection`, `text+collection`).
    You will need to build a frontend chat interface that interacts with this endpoint. The `cors` middleware is configured to allow requests from `https://venturajoyeria.com`; you may need to adjust this in `server.js` for your specific domain during development or for other deployments.

## Future Development

Some potential areas for future development include:

*   **More Sophisticated NLP:** Implement more advanced intent recognition and entity extraction to better understand user queries.
*   **Admin Interface:** Create a simple admin panel to manage data sources, re-index data, and view chat logs.
*   **Support for More Languages:** Extend the widget to handle queries in other languages.
*   **Proactive Chat:** Implement features for proactive chat initiation based on user behavior on the website.
*   **Analytics Dashboard:** Track chat interactions and provide insights into common user questions and product interests.
*   **Testing:** Add a comprehensive suite of unit and integration tests.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details (if one is created, otherwise, standard MIT terms apply).

---

*This README was generated by an AI assistant.*
