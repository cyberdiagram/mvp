# Kali Linux MCP Server — Dynamic Execution + Information Retrieval
# Base image: Kali Rolling with pre-installed pentest tools
FROM kalilinux/kali-rolling

# Avoid interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Install pentest toolkit + exploitdb for searchsploit
RUN apt-get update && apt-get install -y \
    python3-full \
    python3-pip \
    curl \
    wget \
    git \
    nmap \
    nikto \
    hydra \
    sqlmap \
    gobuster \
    whatweb \
    netcat-traditional \
    iputils-ping \
    dnsutils \
    exploitdb \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for MCP Server
COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --break-system-packages -r /tmp/requirements.txt

# Create the working directory
WORKDIR /app
RUN mkdir -p /app/logs /app/scripts

# Copy MCP Server code into the container
COPY server.py /app/

EXPOSE 3001

# Start the MCP Server when the container launches
CMD ["python3", "server.py"]
