from diagrams import Diagram, Edge, Cluster
from diagrams.aws.database import Dynamodb
from diagrams.aws.integration import SimpleQueueServiceSqsQueue, Eventbridge
from diagrams.aws.compute import Lambda
from diagrams.aws.general import General

with Diagram(
    "SaaS Metering Pipeline",
    filename="workshop-guides/saas-metering-flow",
    show=False,
    direction="LR",
    graph_attr={
        "fontsize": "14",
        "bgcolor": "white",
        "pad": "0.5",
        "nodesep": "1.2",
        "ranksep": "1.5",
    },
    edge_attr={
        "fontsize": "11",
    },
):
    app = General("Your SaaS\nApplication")
    
    metering_table = Dynamodb("MeteringRecords\nTable")
    
    schedule = Eventbridge("EventBridge\nRule (hourly)")
    
    metering_job = Lambda("Metering Job")
    
    queue = SimpleQueueServiceSqsQueue("SQS Queue")
    
    processor = Lambda("Metering\nProcessor")
    
    api = General("BatchMeterUsage\nAPI")

    app >> Edge(label="  writes usage  ") >> metering_table
    schedule >> Edge(label="  triggers  ") >> metering_job
    metering_job >> Edge(label="  queries pending  ") >> metering_table
    metering_job >> Edge(label="  sends batches  ") >> queue
    queue >> Edge(label="  triggers  ") >> processor
    processor >> Edge(label="  submits usage  ") >> api
    processor >> Edge(label="  marks processed  ", style="dashed") >> metering_table
