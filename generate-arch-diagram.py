from diagrams import Diagram, Cluster, Edge
from diagrams.aws.general import Users, User, Marketplace
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.storage import S3
from diagrams.aws.compute import Lambda
from diagrams.aws.database import DynamodbTable
from diagrams.aws.integration import SNS, SQS, Eventbridge, EventbridgeScheduler

graph_attr = {
    "fontsize": "18",
    "bgcolor": "white",
    "pad": "1.0",
    "nodesep": "1.0",
    "ranksep": "1.8",
    "fontname": "Helvetica-Bold",
    "labelloc": "t",
    "labeljust": "l",
}
node_attr = {"fontsize": "10", "fontname": "Helvetica"}
edge_attr = {"fontsize": "9", "fontname": "Helvetica"}

with Diagram(
    "AWS Marketplace SaaS\nRegistration & Lifecycle Management",
    filename="generated-diagrams/architecture-v4",
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=edge_attr,
    outformat="png",
):
    buyer = Users("AWS Marketplace\nBuyer")
    seller = User("Seller\nAdmin")

    with Cluster("1. Customer Registration Flow", graph_attr={"bgcolor": "#EFF6FB", "style": "rounded", "color": "#147EB4", "penwidth": "2", "fontcolor": "#147EB4", "fontsize": "14", "fontname": "Helvetica-Bold"}):
        mp_reg = Marketplace("AWS\nMarketplace")
        cf = CloudFront("Amazon\nCloudFront")
        s3_page = S3("Amazon S3\n(Landing Page)")
        edge_fn = Lambda("Lambda@Edge\n(POST to GET)")
        apigw = APIGateway("API\nGateway")
        reg_fn = Lambda("Register\nSubscriber")

    with Cluster("2. Subscription Lifecycle Events (EventBridge)", graph_attr={"bgcolor": "#FEF3F0", "style": "rounded", "color": "#DD344C", "penwidth": "2", "fontcolor": "#DD344C", "fontsize": "14", "fontname": "Helvetica-Bold"}):
        mp_eb = Marketplace("AWS\nMarketplace")
        eb = Eventbridge("Amazon\nEventBridge")
        lc_fn = Lambda("Subscription\nEvent Handler")

    with Cluster("3. Usage Metering Pipeline", graph_attr={"bgcolor": "#F5F0FE", "style": "rounded", "color": "#8C4FFF", "penwidth": "2", "fontcolor": "#8C4FFF", "fontsize": "14", "fontname": "Helvetica-Bold"}):
        sched = EventbridgeScheduler("EventBridge\nScheduler\n(Hourly)")
        mj = Lambda("Metering\nAggregator")
        met_tbl = DynamodbTable("DynamoDB\nMetering Records")
        sqs_q = SQS("Amazon SQS\nMetering Queue")
        mp_proc = Lambda("Metering\nProcessor")
        mp_meter = Marketplace("AWS Marketplace\n(BatchMeterUsage)")

    with Cluster("Shared Resources", graph_attr={"bgcolor": "#FAFAFA", "style": "dashed,rounded", "color": "#545b64", "fontcolor": "#545b64", "fontsize": "13", "fontname": "Helvetica-Bold"}):
        sub_tbl = DynamodbTable("DynamoDB\nSubscribers")
        sns_topic = SNS("Amazon SNS\nNotifications")

    # Flow 1: Registration (blue)
    buyer >> Edge(label="  Subscribe  ", color="#147EB4", penwidth="2") >> mp_reg
    mp_reg >> Edge(label="  Fulfillment URL  ", color="#147EB4", penwidth="2") >> cf
    cf - Edge(label="Serves page", color="#888888", style="dashed") - s3_page
    cf >> Edge(label="  POST token  ", color="#147EB4", penwidth="2") >> edge_fn
    edge_fn >> Edge(label="  POST /register  ", color="#147EB4", penwidth="2") >> apigw
    apigw >> Edge(color="#147EB4", penwidth="2") >> reg_fn
    reg_fn >> Edge(label="  ResolveCustomer\n  & save  ", color="#147EB4", penwidth="2") >> sub_tbl
    reg_fn >> Edge(label="  Notify signup  ", color="#E07941", penwidth="2") >> sns_topic

    # Flow 2: Lifecycle (red)
    mp_eb >> Edge(label="  Agreement Created/\n  Amended/Ended  ", color="#DD344C", penwidth="2") >> eb
    eb >> Edge(label="  Rule match  ", color="#DD344C", penwidth="2") >> lc_fn
    lc_fn >> Edge(label="  Update status  ", color="#DD344C", penwidth="2") >> sub_tbl
    lc_fn >> Edge(label="Notify event", color="#E07941", style="dashed") >> sns_topic

    # Flow 3: Metering (purple)
    sched >> Edge(label="  Every hour  ", color="#8C4FFF", penwidth="2") >> mj
    mj - Edge(label="Query pending", color="#8C4FFF", style="dashed") - met_tbl
    mj >> Edge(label="  Enqueue batches  ", color="#8C4FFF", penwidth="2") >> sqs_q
    sqs_q >> Edge(color="#8C4FFF", penwidth="2") >> mp_proc
    mp_proc >> Edge(label="  BatchMeterUsage  ", color="#8C4FFF", penwidth="2") >> mp_meter
    mp_proc >> Edge(label="Mark sent", color="#8C4FFF", style="dashed") >> met_tbl
    mp_proc >> Edge(label="Update totals", color="#8C4FFF", style="dashed") >> sub_tbl

    # Notifications to seller
    sns_topic >> Edge(label="  Email  ", color="#E07941", style="dashed") >> seller
